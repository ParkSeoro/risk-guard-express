import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-trigger-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function classifyObject(path: string): {
  domain: string;
  projectId: string | null;
  eligibleForBackup: boolean;
  neverPurge: boolean;
} {
  const lower = path.toLowerCase();
  const segs = path.split("/");
  const first = segs[0] || "";
  const second = (segs[1] || "").toLowerCase();

  // Always keep active maps in Supabase (loaded daily by workers)
  if (lower.includes("/site-maps/") || lower.includes("/drone-maps/")) {
    return { domain: "site_map", projectId: UUID_RE.test(first) ? first : null, eligibleForBackup: false, neverPurge: true };
  }
  // Print cache is regenerable — never copy to Google One
  if (lower.includes("/print-cache/")) {
    return { domain: "print_cache", projectId: UUID_RE.test(first) ? first : null, eligibleForBackup: false, neverPurge: true };
  }
  // Messenger chat attachments — excluded from purge until Phase 2 refcount + is_self_chat gate
  if (lower.startsWith("chat/")) {
    return { domain: "chat", projectId: null, eligibleForBackup: false, neverPurge: true };
  }
  if (lower.startsWith("safety-cost/")) {
    const pid = UUID_RE.test(segs[1] || "") ? segs[1] : null;
    return { domain: "safety_cost", projectId: pid, eligibleForBackup: true, neverPurge: false };
  }
  if (lower.startsWith("worker-photos/") || lower.startsWith("feedback/")) {
    const pid = UUID_RE.test(segs[1] || "") ? segs[1] : null;
    return { domain: "risk_assessment", projectId: pid, eligibleForBackup: true, neverPurge: false };
  }
  if (UUID_RE.test(first)) {
    const allowedDomains: Record<string, string> = {
      "work-plans": "work_plan",
      "tbm": "tbm",
      "safety-inspection": "safety_inspection",
      "mobile-inspect": "safety_inspection",
      "inspection-actions": "safety_inspection",
      "accidents": "accident",
      "incidents": "incident",
      "work-stop": "work_stop",
      "chemicals": "chemical",
      "worker-sign": "worker_sign",
    };
    const domain = allowedDomains[second];
    if (domain) {
      return { domain, projectId: first, eligibleForBackup: true, neverPurge: false };
    }
  }
  // Unknown / new paths default to never_purge = true (Allowlist-only safety)
  return { domain: "other", projectId: UUID_RE.test(first) ? first : null, eligibleForBackup: false, neverPurge: true };
}

async function getRuntimeSecret(admin: ReturnType<typeof createClient>, key: string): Promise<string> {
  const fromEnv = (Deno.env.get(key) || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const { data } = await admin.rpc("get_runtime_secret", { secret_name: key });
    if (typeof data === "string" && data.trim()) return data.trim();
  } catch {
    /* ignore */
  }
  return "";
}

async function getGoogleAccessToken(admin: ReturnType<typeof createClient>): Promise<string> {
  const clientId = await getRuntimeSecret(admin, "GDRIVE_CLIENT_ID");
  const clientSecret = await getRuntimeSecret(admin, "GDRIVE_CLIENT_SECRET");
  const refreshToken = await getRuntimeSecret(admin, "GDRIVE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("GDRIVE_OAUTH_NOT_CONFIGURED");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(`GDRIVE_AUTH_ERROR:${data?.error || res.status}`);
  }
  return String(data.access_token);
}

async function ensureDriveFolder(
  token: string,
  name: string,
  parentId?: string,
  cache?: Map<string, string>,
): Promise<string> {
  const cacheKey = `${parentId || "root"}/${name}`;
  if (cache?.has(cacheKey)) return cache.get(cacheKey)!;

  const qParts = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    `trashed = false`,
  ];
  if (parentId) qParts.push(`'${parentId}' in parents`);

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qParts.join(" and "))}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!searchRes.ok) throw new Error(`GDRIVE_FOLDER_SEARCH_${searchRes.status}`);
  const searchJson = await searchRes.json();
  if (searchJson?.files?.[0]?.id) {
    const id = String(searchJson.files[0].id);
    cache?.set(cacheKey, id);
    return id;
  }

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!createRes.ok) throw new Error(`GDRIVE_FOLDER_CREATE_${createRes.status}`);
  const created = await createRes.json();
  const id = String(created.id);
  cache?.set(cacheKey, id);
  return id;
}

async function uploadToDriveMultipart(opts: {
  token: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ id: string; sha256Checksum: string }> {
  const boundary = `safenex_${crypto.randomUUID().replace(/-/g, "")}`;
  const meta = JSON.stringify({
    name: opts.fileName,
    parents: [opts.folderId],
  });
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: ${opts.mimeType || "application/octet-stream"}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const payload = new Uint8Array(head.length + opts.bytes.length + tail.length);
  payload.set(head, 0);
  payload.set(opts.bytes, head.length);
  payload.set(tail, head.length + opts.bytes.length);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,sha256Checksum,trashed",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: payload,
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GDRIVE_UPLOAD_${res.status}:${txt.slice(0, 160)}`);
  }
  const json = await res.json();
  return {
    id: String(json.id || ""),
    sha256Checksum: String(json.sha256Checksum || ""),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Auth: either X-Backup-Trigger-Secret OR master user JWT
  const triggerSecret = await getRuntimeSecret(admin, "BACKUP_TRIGGER_SECRET");
  const reqSecret = (req.headers.get("x-backup-trigger-secret") || "").trim();
  let authorized = Boolean(triggerSecret && reqSecret && reqSecret === triggerSecret);

  if (!authorized) {
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: u } = await userClient.auth.getUser();
      if (u?.user?.id) {
        const { data: masterRole } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", u.user.id)
          .eq("role", "master")
          .maybeSingle();
        authorized = Boolean(masterRole);
      }
    }
  }
  if (!authorized) return jsonRes({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  // Default is strictly backup_only (purge OFF) per PR #684 Clause 7
  const purgeEnabled = body?.purge_enabled === true;
  const copyMinAgeDays = Math.max(1, Number(body?.copy_min_age_days ?? 30));
  const purgeMinAgeDays = Math.max(30, Number(body?.purge_min_age_days ?? 60));
  const maxFiles = Math.min(30, Math.max(1, Number(body?.max_files ?? 15)));
  const maxBytesBudget = Math.min(100 * 1024 * 1024, Math.max(10 * 1024 * 1024, Number(body?.max_bytes ?? 50 * 1024 * 1024)));

  const startedAt = Date.now();
  const mode = purgeEnabled ? "purge_active" : "backup_only";

  const { data: runRow } = await admin
    .from("storage_backup_runs")
    .insert({ mode })
    .select("id")
    .single();
  const runId = runRow?.id;

  let copiedCnt = 0;
  let verifiedCnt = 0;
  let purgedCnt = 0;
  let skippedCnt = 0;
  let errorCnt = 0;
  let circuitBroken = false;
  let quotaUsed: number | null = null;
  let quotaLimit: number | null = null;
  let notes = "";

  try {
    const token = await getGoogleAccessToken(admin);

    // Quota pre-check (80% warn, 90% abort & freeze purge)
    const aboutRes = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=storageQuota",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!aboutRes.ok) {
      circuitBroken = true;
      throw new Error(`GDRIVE_QUOTA_CHECK_${aboutRes.status}`);
    }
    const aboutJson = await aboutRes.json();
    quotaUsed = Number(aboutJson?.storageQuota?.usage || 0);
    quotaLimit = Number(aboutJson?.storageQuota?.limit || 0);
    if (quotaLimit > 0) {
      const pct = (quotaUsed / quotaLimit) * 100;
      if (pct >= 90) {
        circuitBroken = true;
        notes = `Circuit breaker: Google Drive quota at ${pct.toFixed(1)}% (>= 90%)`;
        return jsonRes({ ok: false, circuit_broken: true, quota_pct: pct, notes }, 503);
      }
      if (pct >= 80) {
        notes = `Warning: Google Drive quota at ${pct.toFixed(1)}%`;
      }
    }

    const folderCache = new Map<string, string>();
    const rootFolderId = await ensureDriveFolder(token, "SafeNex-Archive", undefined, folderCache);

    // Stage 1: Copy attachments older than copyMinAgeDays that are not yet backed_up
    const { data: candidates, error: candErr } = await admin.rpc("list_archive_candidate_objects", {
      _bucket_id: "attachments",
      _min_age_days: copyMinAgeDays,
      _limit: maxFiles * 2,
    });
    if (candErr) throw new Error(`LIST_CANDIDATES:${candErr.message}`);

    let bytesProcessed = 0;
    for (const obj of (candidates || []) as Array<{
      object_path: string;
      file_size: number | null;
      mime_type: string | null;
      created_at: string;
    }>) {
      if (copiedCnt >= maxFiles) break;
      if (Date.now() - startedAt > 42_000) break;
      if (bytesProcessed >= maxBytesBudget) break;

      const cls = classifyObject(obj.object_path);
      if (!cls.eligibleForBackup) {
        skippedCnt += 1;
        continue;
      }

      try {
        const { data: blob, error: dlErr } = await admin.storage
          .from("attachments")
          .download(obj.object_path);
        if (dlErr || !blob) {
          errorCnt += 1;
          continue;
        }
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        bytesProcessed += bytes.length;
        const localSha = await sha256Hex(buf);

        const ym = String(obj.created_at || new Date().toISOString()).slice(0, 7);
        const projFolder = await ensureDriveFolder(token, cls.projectId || "shared", rootFolderId, folderCache);
        const domFolder = await ensureDriveFolder(token, cls.domain, projFolder, folderCache);
        const ymFolder = await ensureDriveFolder(token, ym, domFolder, folderCache);

        const leafName = obj.object_path.split("/").pop() || "file";
        const uploaded = await uploadToDriveMultipart({
          token,
          folderId: ymFolder,
          fileName: leafName,
          mimeType: obj.mime_type || "application/octet-stream",
          bytes,
        });

        if (!uploaded.id || (uploaded.sha256Checksum && uploaded.sha256Checksum !== localSha)) {
          errorCnt += 1;
          await admin.from("storage_archive_registry").upsert(
            {
              bucket_id: "attachments",
              object_path: obj.object_path,
              domain: cls.domain,
              project_id: cls.projectId,
              file_size: bytes.length,
              mime_type: obj.mime_type,
              sha256_hash: localSha,
              archive_status: "failed",
              never_purge: true,
              source_created_at: obj.created_at,
              last_error: "upload_checksum_mismatch",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "bucket_id,object_path" },
          );
          continue;
        }

        await admin.from("storage_archive_registry").upsert(
          {
            bucket_id: "attachments",
            object_path: obj.object_path,
            domain: cls.domain,
            project_id: cls.projectId,
            file_size: bytes.length,
            mime_type: obj.mime_type,
            sha256_hash: localSha,
            storage_provider: "GDRIVE",
            gdrive_file_id: uploaded.id,
            gdrive_folder_path: `/SafeNex-Archive/${cls.projectId || "shared"}/${cls.domain}/${ym}`,
            archive_status: "backed_up",
            never_purge: cls.neverPurge,
            source_created_at: obj.created_at,
            backed_up_at: new Date().toISOString(),
            verified_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "bucket_id,object_path" },
        );
        copiedCnt += 1;
        verifiedCnt += 1;
      } catch (itemErr) {
        const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
        errorCnt += 1;
        if (msg.includes("401") || msg.includes("403") || msg.includes("invalid_grant") || msg.includes("storageQuotaExceeded")) {
          circuitBroken = true;
          notes = `Circuit breaker triggered: ${msg}`;
          break;
        }
      }
    }

    // Stage 2: Purge ONLY when explicitly enabled AND not circuit-broken
    if (purgeEnabled && !circuitBroken && Date.now() - startedAt < 40_000) {
      const ageCutoff = new Date(Date.now() - purgeMinAgeDays * 86400_000).toISOString();
      const { data: purgeList } = await admin
        .from("storage_archive_registry")
        .select("id, object_path, gdrive_file_id, sha256_hash")
        .eq("bucket_id", "attachments")
        .eq("archive_status", "backed_up")
        .eq("never_purge", false)
        .eq("legal_hold", false)
        .not("gdrive_file_id", "is", null)
        .lte("source_created_at", ageCutoff)
        .order("source_created_at", { ascending: true })
        .limit(maxFiles);

      for (const row of (purgeList || []) as Array<{
        id: string;
        object_path: string;
        gdrive_file_id: string;
        sha256_hash: string | null;
      }>) {
        if (Date.now() - startedAt > 45_000) break;
        // Re-verify live Drive metadata (trashed = false + sha256Checksum match) immediately before purge
        const metaRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(row.gdrive_file_id)}?fields=id,trashed,sha256Checksum`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!metaRes.ok) {
          if (metaRes.status === 401 || metaRes.status === 403) {
            circuitBroken = true;
            notes = `Purge halted on auth error ${metaRes.status}`;
            break;
          }
          errorCnt += 1;
          continue;
        }
        const meta = await metaRes.json();
        if (meta.trashed === true || (row.sha256_hash && meta.sha256Checksum !== row.sha256_hash)) {
          errorCnt += 1;
          continue;
        }

        const { error: rmErr } = await admin.storage.from("attachments").remove([row.object_path]);
        if (rmErr) {
          errorCnt += 1;
          continue;
        }

        await admin
          .from("storage_archive_registry")
          .update({
            archive_status: "archived_purged",
            verified_at: new Date().toISOString(),
            purged_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        purgedCnt += 1;
      }
    }

    return jsonRes({
      ok: true,
      mode,
      copied_cnt: copiedCnt,
      verified_cnt: verifiedCnt,
      purged_cnt: purgedCnt,
      skipped_cnt: skippedCnt,
      error_cnt: errorCnt,
      circuit_broken: circuitBroken,
      quota_used_bytes: quotaUsed,
      quota_limit_bytes: quotaLimit,
      notes,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("GDRIVE_AUTH") || msg.includes("401") || msg.includes("403")) {
      circuitBroken = true;
    }
    notes = msg;
    return jsonRes({ ok: false, error: msg, circuit_broken: circuitBroken }, 500);
  } finally {
    if (runId) {
      await admin
        .from("storage_backup_runs")
        .update({
          finished_at: new Date().toISOString(),
          copied_cnt: copiedCnt,
          verified_cnt: verifiedCnt,
          purged_cnt: purgedCnt,
          skipped_cnt: skippedCnt,
          error_cnt: errorCnt,
          circuit_broken: circuitBroken,
          quota_used_bytes: quotaUsed,
          quota_limit_bytes: quotaLimit,
          notes: notes || null,
        })
        .eq("id", runId);
    }
  }
});
