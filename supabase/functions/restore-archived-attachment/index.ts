import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    throw new Error(`GDRIVE_TOKEN_ERROR:${data?.error || res.status}`);
  }
  return String(data.access_token);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonRes({ error: "unauthorized" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonRes({ error: "unauthorized" }, 401);
  }
  const userId = userData.user.id;

  let body: { bucket_id?: string; object_path?: string; file_name?: string };
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "invalid_json" }, 400);
  }

  const bucketId = String(body.bucket_id || "attachments").trim();
  const objectPath = String(body.object_path || "").trim().replace(/^\/+/, "");
  const fileName = body.file_name ? String(body.file_name).trim() : undefined;
  if (!objectPath || objectPath.includes("..")) {
    return jsonRes({ error: "invalid_object_path" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // 1. Lookup archive registry
  const { data: reg, error: regErr } = await admin
    .from("storage_archive_registry")
    .select("id, bucket_id, object_path, project_id, mime_type, sha256_hash, gdrive_file_id, archive_status")
    .eq("bucket_id", bucketId)
    .eq("object_path", objectPath)
    .maybeSingle();

  if (regErr) {
    return jsonRes({ error: regErr.message }, 500);
  }

  // Fast-path: still active or backed_up in Supabase
  if (!reg || reg.archive_status !== "archived_purged" || !reg.gdrive_file_id) {
    const { data: pub } = admin.storage.from(bucketId).getPublicUrl(objectPath);
    return jsonRes({ mode: "supabase", url: pub.publicUrl, expires_in: null });
  }

  // 2. Multi-tenant authorization check before restoring
  const { data: masterRole } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "master")
    .maybeSingle();
  const isMaster = Boolean(masterRole);
  if (!isMaster) {
    if (objectPath.startsWith("chat/")) {
      const roomId = objectPath.split("/")[1];
      const { data: part } = await admin
        .from("chat_participants")
        .select("room_id")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!part) return jsonRes({ error: "forbidden_chat_room" }, 403);
    } else if (reg.project_id) {
      const { data: mem } = await admin
        .from("project_members")
        .select("id")
        .eq("project_id", reg.project_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!mem) return jsonRes({ error: "forbidden_project" }, 403);
    }
  }

  const cachePath = `${bucketId}/${objectPath}`;
  const signOpts = fileName ? { download: fileName } : undefined;

  // 3. Try existing cache object first (avoids redundant Google Drive API calls)
  const { data: cachedSign } = await admin.storage
    .from("archive-restore-cache")
    .createSignedUrl(cachePath, 300, signOpts);
  if (cachedSign?.signedUrl) {
    // Quick HEAD to verify cached object actually exists
    const headRes = await fetch(cachedSign.signedUrl, { method: "HEAD" }).catch(() => null);
    if (headRes?.ok) {
      await admin
        .from("storage_archive_registry")
        .update({ last_restored_at: new Date().toISOString() })
        .eq("id", reg.id);
      return jsonRes({ mode: "restored_cache", url: cachedSign.signedUrl, expires_in: 300 });
    }
  }

  // 4. Download from Google Drive and verify SHA-256
  try {
    const accessToken = await getGoogleAccessToken(admin);
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(reg.gdrive_file_id)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!driveRes.ok) {
      return jsonRes({ error: `gdrive_download_failed_${driveRes.status}` }, 502);
    }
    const bytes = await driveRes.arrayBuffer();
    if (reg.sha256_hash) {
      const actualHash = await sha256Hex(bytes);
      if (actualHash !== reg.sha256_hash) {
        return jsonRes({ error: "checksum_mismatch" }, 500);
      }
    }

    const { error: upErr } = await admin.storage
      .from("archive-restore-cache")
      .upload(cachePath, bytes, {
        contentType: reg.mime_type || "application/octet-stream",
        upsert: true,
      });
    if (upErr) {
      return jsonRes({ error: `cache_upload_failed:${upErr.message}` }, 500);
    }

    const { data: signed, error: signErr } = await admin.storage
      .from("archive-restore-cache")
      .createSignedUrl(cachePath, 300, signOpts);
    if (signErr || !signed?.signedUrl) {
      return jsonRes({ error: signErr?.message || "sign_failed" }, 500);
    }

    await admin
      .from("storage_archive_registry")
      .update({ last_restored_at: new Date().toISOString() })
      .eq("id", reg.id);

    return jsonRes({ mode: "restored", url: signed.signedUrl, expires_in: 300 });
  } catch (e) {
    return jsonRes({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
