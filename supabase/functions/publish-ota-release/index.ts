// supabase/functions/publish-ota-release/index.ts
// GitHub Actions(또는 CI)가 OTA 번들을 자동 게시하는 엔드포인트.
//
// 인증: Authorization: Bearer <OTA_PUBLISH_TOKEN>
// 메타: 헤더 X-OTA-Version, X-OTA-Channel, X-OTA-Mandatory, X-OTA-Notes,
//       X-OTA-Min-Native-Version
// 바디: zip 파일 바이너리(Content-Type: application/zip)
//
// 처리:
//   1) app-updates 비공개 버킷에 업로드
//   2) public.app_releases 에 행 삽입(체크섬 포함)
//   3) JSON 으로 결과 반환

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-ota-version, x-ota-channel, x-ota-mandatory, x-ota-notes, x-ota-min-native-version",
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

  // 1) 인증
  const expected = Deno.env.get("OTA_PUBLISH_TOKEN");
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !token || token !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  // 2) 메타
  const version = (req.headers.get("X-OTA-Version") || "").trim();
  const channel = (req.headers.get("X-OTA-Channel") || "stable").trim();
  const mandatory = (req.headers.get("X-OTA-Mandatory") || "false") === "true";
  const minNative = (req.headers.get("X-OTA-Min-Native-Version") || "").trim();
  const notes = req.headers.get("X-OTA-Notes") || "";
  if (!version) return json({ error: "missing_version" }, 400);

  // 3) 바디
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return json({ error: "empty_body" }, 400);
  if (buf.byteLength > 50 * 1024 * 1024)
    return json({ error: "bundle_too_large", limit: "50MB" }, 413);

  const checksum = toHex(await crypto.subtle.digest("SHA-256", buf));
  const path = `${channel}/${version}-${Date.now()}.zip`;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 4) 업로드
  const up = await supabase.storage
    .from("app-updates")
    .upload(path, new Uint8Array(buf), {
      contentType: "application/zip",
      upsert: false,
    });
  if (up.error) return json({ error: "upload_failed", detail: up.error.message }, 500);

  // 5) 행 삽입
  const { data, error } = await supabase
    .from("app_releases")
    .insert({
      version,
      channel,
      bundle_url: `storage:${path}`,
      checksum,
      mandatory,
      min_native_version: minNative || null,
      notes: notes || `Published from CI at ${new Date().toISOString()}`,
    })
    .select()
    .single();

  if (error) {
    // 충돌 시 업로드한 파일도 청소
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
