// supabase/functions/publish-ota-release/index.ts
// GitHub Actions(또는 CI)가 OTA 번들을 자동 게시하는 엔드포인트.
//
// 인증 (둘 중 하나):
//   - Authorization: Bearer <OTA_PUBLISH_TOKEN>
//   - X-OTA-Publish-Token: <OTA_PUBLISH_TOKEN>
// (Supabase 게이트웨이 JWT 검증은 config.toml 에서 verify_jwt=false)
// 메타: 헤더 또는 JSON 바디
//       X-OTA-Version, X-OTA-Channel, X-OTA-Platform, X-OTA-Mandatory, X-OTA-Notes,
//       X-OTA-Min-Native-Version, X-OTA-Set-Min-Native-Only
//       X-OTA-Platform: android | desktop | both. 생략하면 both.
// 바디: zip 파일 바이너리. min-native-only 이면 JSON 허용.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-ota-version, x-ota-channel, x-ota-platform, x-ota-mandatory, x-ota-notes, x-ota-min-native-version, x-ota-publish-token, x-ota-set-min-native-only, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const truthy = (v: unknown) =>
  v === true || v === 1 || String(v ?? "").trim() === "1" || String(v ?? "").toLowerCase() === "true";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1) 인증 — custom secret (not Supabase user JWT)
  const expected = Deno.env.get("OTA_PUBLISH_TOKEN");
  const auth = req.headers.get("Authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const headerTok = (req.headers.get("X-OTA-Publish-Token") || "").trim();
  const token = headerTok || bearer;
  if (!expected || !token || token !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const headerMinOnly =
    (req.headers.get("X-OTA-Set-Min-Native-Only") || "").trim() === "1" ||
    (req.headers.get("X-OTA-Set-Min-Native-Only") || "").toLowerCase() === "true";
  const contentType = (req.headers.get("Content-Type") || "").toLowerCase();

  let body: Record<string, unknown> = {};
  let zipBuf: ArrayBuffer | null = null;
  if (headerMinOnly || contentType.includes("application/json")) {
    const text = await req.text();
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
    }
  } else {
    zipBuf = await req.arrayBuffer();
  }

  const version = (
    req.headers.get("X-OTA-Version") ||
    String(body.version ?? "")
  ).trim();
  const channel = (
    req.headers.get("X-OTA-Channel") ||
    String(body.channel ?? "stable") ||
    "stable"
  ).trim();
  const mandatory =
    (req.headers.get("X-OTA-Mandatory") || "false") === "true" ||
    truthy(body.mandatory);
  const minNative = (
    req.headers.get("X-OTA-Min-Native-Version") ||
    String(body.min_native_version ?? "")
  ).trim();
  const notes = req.headers.get("X-OTA-Notes") || String(body.notes ?? "");
  const minOnly = headerMinOnly || truthy(body.min_native_only);
  const platformRaw = (
    req.headers.get("X-OTA-Platform") ||
    String(body.platform ?? "")
  ).trim().toLowerCase();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const latestOn = (platform: string) =>
    supabase
      .from("app_releases")
      .select("id, version, channel, min_native_version, platform")
      .eq("channel", channel)
      .eq("is_deleted", false)
      .eq("platform", platform)
      .order("released_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  // AAB CI: bump Play floor on the latest android row, else the latest shared row.
  // desktop rows keep min_native_version empty.
  if (minOnly) {
    if (platformRaw === "desktop") return json({ error: "min_native_desktop" }, 400);
    if (!minNative) return json({ error: "missing_min_native" }, 400);
    let targetRes = await latestOn("android");
    if (targetRes.error) return json({ error: "lookup_failed", detail: targetRes.error.message }, 500);
    if (!targetRes.data?.id) {
      targetRes = await latestOn("shared");
      if (targetRes.error) return json({ error: "lookup_failed", detail: targetRes.error.message }, 500);
    }
    const latest = targetRes.data;
    if (!latest?.id) return json({ error: "no_release" }, 404);
    const { error: upErr } = await supabase
      .from("app_releases")
      .update({ min_native_version: minNative })
      .eq("id", latest.id);
    if (upErr) return json({ error: "update_failed", detail: upErr.message }, 500);
    return json({
      ok: true,
      min_native_only: true,
      id: latest.id,
      version: latest.version,
      platform: latest.platform,
      min_native_version: minNative,
    });
  }

  if (!version) return json({ error: "missing_version" }, 400);
  const platformHeader = platformRaw || "both";
  const platforms = platformHeader === "both"
    ? ["android", "desktop"]
    : platformHeader === "android" || platformHeader === "desktop"
    ? [platformHeader]
    : null;
  if (!platforms) return json({ error: "invalid_platform" }, 400);

  // 3) 바디
  const buf = zipBuf ?? await req.arrayBuffer();
  if (!buf.byteLength) return json({ error: "empty_body" }, 400);
  if (buf.byteLength > 50 * 1024 * 1024)
    return json({ error: "bundle_too_large", limit: "50MB" }, 413);

  const checksum = toHex(await crypto.subtle.digest("SHA-256", buf));
  const path = `${channel}/${version}-${Date.now()}.zip`;

  // 4) 업로드
  const up = await supabase.storage
    .from("app-updates")
    .upload(path, new Uint8Array(buf), {
      contentType: "application/zip",
      upsert: false,
    });
  if (up.error) return json({ error: "upload_failed", detail: up.error.message }, 500);

  // Keep the Play floor across OTA publishes unless CI sends a new value.
  // Only the android row carries it. A desktop row stays empty.
  let resolvedMin: string | null = null;
  if (platforms.includes("android")) {
    resolvedMin = minNative || null;
    if (!resolvedMin) {
      const android = await latestOn("android");
      const fromAndroid = android.data?.min_native_version
        ? String(android.data.min_native_version)
        : null;
      if (fromAndroid) resolvedMin = fromAndroid;
      else {
        const shared = await latestOn("shared");
        resolvedMin = shared.data?.min_native_version
          ? String(shared.data.min_native_version)
          : null;
      }
    }
  }

  // 5) 행 upsert. both 는 같은 zip 을 android 행과 desktop 행에 같이 둔다.
  const { data, error } = await supabase
    .from("app_releases")
    .upsert(
      platforms.map((platform) => ({
        version,
        channel,
        platform,
        bundle_url: `storage:${path}`,
        checksum,
        mandatory,
        min_native_version: platform === "android" ? resolvedMin : null,
        notes: notes || `Published from CI at ${new Date().toISOString()}`,
        is_deleted: false,
      })),
      { onConflict: "channel,version,platform" },
    )
    .select();

  if (error) {
    await supabase.storage.from("app-updates").remove([path]);
    return json({ error: "insert_failed", detail: error.message }, 500);
  }

  const rows = Array.isArray(data) ? data : [];
  const androidRow = rows.find((row) => row.platform === "android") || rows[0];
  return json({
    ok: true,
    release: {
      id: androidRow?.id,
      version,
      channel,
      platforms,
      bundle_url: `storage:${path}`,
      checksum,
      size_bytes: buf.byteLength,
      min_native_version: resolvedMin,
    },
  });
});
