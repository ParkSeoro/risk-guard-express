// supabase/functions/publish-ota-release/index.ts
// GitHub Actions(또는 CI)가 OTA 번들을 자동 게시하는 엔드포인트.
//
// 인증 (둘 중 하나):
//   - Authorization: Bearer <OTA_PUBLISH_TOKEN>
//   - X-OTA-Publish-Token: <OTA_PUBLISH_TOKEN>
// (Supabase 게이트웨이 JWT 검증은 config.toml 에서 verify_jwt=false)
// 메타: 헤더 X-OTA-Version, X-OTA-Channel, X-OTA-Mandatory, X-OTA-Notes,
//       X-OTA-Min-Native-Version, X-OTA-Set-Min-Native-Only
// 바디: zip 파일 바이너리. min-native-only 이면 빈 바디 허용.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-ota-version, x-ota-channel, x-ota-mandatory, x-ota-notes, x-ota-min-native-version, x-ota-publish-token, x-ota-set-min-native-only, apikey",
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

  // 2) 메타
  const version = (req.headers.get("X-OTA-Version") || "").trim();
  const channel = (req.headers.get("X-OTA-Channel") || "stable").trim();
  const mandatory = (req.headers.get("X-OTA-Mandatory") || "false") === "true";
  const minNative = (req.headers.get("X-OTA-Min-Native-Version") || "").trim();
  const notes = req.headers.get("X-OTA-Notes") || "";
  const minOnly =
    (req.headers.get("X-OTA-Set-Min-Native-Only") || "").trim() === "1" ||
    (req.headers.get("X-OTA-Set-Min-Native-Only") || "").toLowerCase() === "true";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // AAB CI: bump Play floor on the latest OTA row without publishing a new zip.
  if (minOnly) {
    if (!minNative) return json({ error: "missing_min_native" }, 400);
    const { data: latest, error: latestErr } = await supabase
      .from("app_releases")
      .select("id, version, channel")
      .eq("channel", channel)
      .eq("is_deleted", false)
      .order("released_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) return json({ error: "lookup_failed", detail: latestErr.message }, 500);
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
      min_native_version: minNative,
    });
  }

  if (!version) return json({ error: "missing_version" }, 400);

  // 3) 바디
  const buf = await req.arrayBuffer();
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

  // 5) 행 upsert (같은 channel+version 재게시 시 덮어쓰기 → CI 재실행 안전)
  const { data, error } = await supabase
    .from("app_releases")
    .upsert(
      {
        version,
        channel,
        bundle_url: `storage:${path}`,
        checksum,
        mandatory,
        min_native_version: minNative || null,
        notes: notes || `Published from CI at ${new Date().toISOString()}`,
        is_deleted: false,
      },
      { onConflict: "channel,version" },
    )
    .select()
    .single();

  if (error) {
    await supabase.storage.from("app-updates").remove([path]);
    return json({ error: "insert_failed", detail: error.message }, 500);
  }

  return json({
    ok: true,
    release: {
      id: data.id,
      version,
      channel,
      bundle_url: `storage:${path}`,
      checksum,
      size_bytes: buf.byteLength,
    },
  });
});
