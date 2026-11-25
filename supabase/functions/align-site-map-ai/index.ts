// Phase 3: Server-side AI Satellite ↔ Drone 4-DOF Draft Alignment.
// Fetches centered satellite imagery server-side (no browser CORS), compares with
// the uploaded drone photo via Gemini Vision, and returns an UNSAVED 4-DOF preview
// (zero skew/distortion). Never modifies DB, attendance spots, or gps_calibration.
// JWT is validated internally via userClient.auth.getUser() (verify_jwt = false).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL_TIMEOUT_MS = 28_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_IMAGE_BYTES = 4_500_000;

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function stripMarkdownFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function isAllowedDroneUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return false;
    // Allow Supabase Storage URLs (our project or custom storage domain)
    if (u.pathname.includes("/storage/v1/object/")) return true;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (supabaseUrl) {
      const su = new URL(supabaseUrl);
      if (u.host === su.host) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!ct.startsWith("image/")) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength === 0 || ab.byteLength > MAX_IMAGE_BYTES) return null;
    return { base64: bytesToBase64(new Uint8Array(ab)), mimeType: ct };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type SatelliteBbox = { west: number; south: number; east: number; north: number };

function buildSearchBbox(centerLat: number, centerLng: number, halfExtentM: number): SatelliteBbox {
  const clamped = Math.min(1200, Math.max(120, halfExtentM));
  const mLat = 111_320;
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.1);
  const mLng = mLat * cosLat;
  return {
    west: centerLng - clamped / mLng,
    south: centerLat - clamped / mLat,
    east: centerLng + clamped / mLng,
    north: centerLat + clamped / mLat,
  };
}

function rotatePoint(
  p: { lat: number; lng: number },
  center: { lat: number; lng: number },
  rad: number,
) {
  const cosLat = Math.cos((center.lat * Math.PI) / 180) || 1e-6;
  const x = (p.lng - center.lng) * cosLat;
  const y = p.lat - center.lat;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    lat: center.lat + (x * sin + y * cos),
    lng: center.lng + (x * cos - y * sin) / cosLat,
  };
}

function estimateToCorners(
  bbox: SatelliteBbox,
  est: { center_x_norm: number; center_y_norm: number; width_frac: number; rotation_deg: number },
  aspectRatio: number,
) {
  const cxNorm = Math.min(0.92, Math.max(0.08, est.center_x_norm));
  const cyNorm = Math.min(0.92, Math.max(0.08, est.center_y_norm));
  const widthFrac = Math.min(0.95, Math.max(0.08, est.width_frac));
  const rotDeg = ((est.rotation_deg + 540) % 360) - 180;
  const aspect = aspectRatio > 0.2 && aspectRatio < 5 ? aspectRatio : 4 / 3;

  const centerLng = bbox.west + cxNorm * (bbox.east - bbox.west);
  const centerLat = bbox.north - cyNorm * (bbox.north - bbox.south);

  const mLat = 111_320;
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.1);
  const mLng = mLat * cosLat;

  const halfW = ((bbox.east - bbox.west) * mLng * widthFrac) / 2;
  const halfH = halfW / aspect;
  const dLat = halfH / mLat;
  const dLng = halfW / mLng;

  const base = {
    tl: { lat: centerLat + dLat, lng: centerLng - dLng },
    tr: { lat: centerLat + dLat, lng: centerLng + dLng },
    bl: { lat: centerLat - dLat, lng: centerLng - dLng },
  };
  if (Math.abs(rotDeg) <= 0.25) return base;
  const rad = (-rotDeg * Math.PI) / 180;
  const center = { lat: centerLat, lng: centerLng };
  return {
    tl: rotatePoint(base.tl, center, rad),
    tr: rotatePoint(base.tr, center, rad),
    bl: rotatePoint(base.bl, center, rad),
  };
}

async function fetchCenteredSatellite(
  bbox: SatelliteBbox,
  centerLat: number,
  centerLng: number,
  vworldKey?: string,
): Promise<{ base64: string; mimeType: string; source: "vworld" | "esri" } | null> {
  // 1) Try Esri World Imagery Export first for exact WGS-84 bbox alignment (guaranteed exact bounds!)
  const esriUrl =
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export` +
    `?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}` +
    `&bboxSR=4326&imageSR=4326&size=768,768&format=jpg&f=image`;
  const esriImg = await fetchImageAsBase64(esriUrl);
  if (esriImg) {
    return { ...esriImg, source: "esri" };
  }

  // 2) Fallback: VWorld Static Aerial Map API if key is available
  const key = (vworldKey || Deno.env.get("VWORLD_API_KEY") || "").trim();
  if (key) {
    const vwUrl =
      `https://api.vworld.kr/req/image?service=image&request=getmap&version=2.0` +
      `&crs=epsg:4326&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}` +
      `&center=${centerLng},${centerLat}&size=768,768&format=jpeg&basemap=PHOTO&key=${encodeURIComponent(key)}`;
    const vwImg = await fetchImageAsBase64(vwUrl);
    if (vwImg) {
      return { ...vwImg, source: "vworld" };
    }
  }
  return null;
}

function buildPrompt(bboxWidthM: number, aspectRatio: number): string {
  return `당신은 건설현장 드론 정사사진(Image 2)을 위성 기준지도(Image 1, 진북 North-up) 위에 4자유도(위치·크기·회전, 왜곡 없음)로 자동 초안 정렬하는 공간영상 분석 AI입니다.

[입력 이미지 설명]
- Image 1: 진북(North-up) 방향의 위성 기준 지도 (전체 가로폭 약 ${Math.round(bboxWidthM)}m, X=0 좌측/서쪽 ~ X=1 우측/동쪽, Y=0 상단/북쪽 ~ Y=1 하단/남쪽)
- Image 2: 건설현장 드론 촬영 사진 (가로/세로 비율 약 ${aspectRatio.toFixed(2)}:1). 공사가 진행되어 지형이나 건물이 위성사진보다 새로 지어졌을 수 있으므로, 주변 도로·교차로·하천·인접 공장 지붕·부지 경계선을 기준으로 매칭하세요.

반드시 아래 JSON 객체 하나만 출력하세요 (코드블록·설명 금지):
{
  "center_x_norm": 0.5,
  "center_y_norm": 0.5,
  "width_frac": 0.45,
  "rotation_deg": 0,
  "confidence": "high" | "medium" | "low",
  "landmarks_matched": ["매칭에 사용한 주변 지형/도로/건물 특징 1~3개 (한국어)"],
  "reason": "정렬 판단 근거 1줄 요약 (한국어)"
}

[필드 규칙]
- center_x_norm (0.08~0.92): Image 2의 중심점이 Image 1에서 차지하는 가로 정규화 좌표
- center_y_norm (0.08~0.92): Image 2의 중심점이 Image 1에서 차지하는 세로 정규화 좌표
- width_frac (0.08~0.95): Image 2의 실제 가로 폭이 Image 1 전체 가로 폭 대비 차지하는 비율
- rotation_deg (-180~180): Image 2를 진북(Image 1)에 맞추기 위해 시계방향으로 회전해야 하는 각도(도)
- 확실한 주변 도로/건물 매칭이 어려우면 억지로 크게 틀지 말고 confidence를 "low"로 표시하세요.`;
}

async function callGeminiDualVision(
  prompt: string,
  sat: { base64: string; mimeType: string },
  drone: { base64: string; mimeType: string },
): Promise<string | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { text: "[Image 1: Satellite Reference (North-up)]" },
              { inline_data: { mime_type: sat.mimeType, data: sat.base64 } },
              { text: "[Image 2: Drone Site Photo]" },
              { inline_data: { mime_type: drone.mimeType, data: drone.base64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      console.warn("[align-site-map-ai] Gemini error:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.warn("[align-site-map-ai] Gemini exception:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResp({ error: "인증이 필요합니다" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !userData?.user) {
    return jsonResp({ error: "유효하지 않은 인증 세션입니다" }, 401);
  }

  let body: {
    drone_image_url?: string;
    center_lat?: number;
    center_lng?: number;
    half_extent_m?: number;
    aspect_ratio?: number;
    vworld_key?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "잘못된 요청 본문입니다" }, 400);
  }

  const droneUrl = (body.drone_image_url || "").trim();
  const centerLat = Number(body.center_lat);
  const centerLng = Number(body.center_lng);
  const halfExtentM = Number(body.half_extent_m) || 350;
  const aspectRatio = Number(body.aspect_ratio) || 4 / 3;

  if (!droneUrl || !isAllowedDroneUrl(droneUrl)) {
    return jsonResp({ error: "허용되지 않은 도면 이미지 URL입니다" }, 400);
  }
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng) || Math.abs(centerLat) > 90 || Math.abs(centerLng) > 180) {
    return jsonResp({ error: "유효한 중심 위경도 좌표가 필요합니다" }, 400);
  }

  const bbox = buildSearchBbox(centerLat, centerLng, halfExtentM);
  const [sat, drone] = await Promise.all([
    fetchCenteredSatellite(bbox, centerLat, centerLng, body.vworld_key),
    fetchImageAsBase64(droneUrl),
  ]);

  if (!sat) {
    return jsonResp({ error: "위성 기준 영상을 불러오지 못했습니다. 잠시 후 다시 시도하세요." }, 502);
  }
  if (!drone) {
    return jsonResp({ error: "드론 도면 이미지를 불러오지 못했습니다 (4.5MB 이하 이미지만 지원)." }, 400);
  }

  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.1);
  const bboxWidthM = (bbox.east - bbox.west) * 111_320 * cosLat;
  const rawText = await callGeminiDualVision(buildPrompt(bboxWidthM, aspectRatio), sat, drone);
  if (!rawText) {
    return jsonResp({ error: "AI 영상 비교 분석에 실패했습니다. 2점 기준점 맞춤이나 모바일 워킹 보정을 이용해 주세요." }, 502);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripMarkdownFences(rawText));
  } catch {
    return jsonResp({ error: "AI 응답 형식을 해석하지 못했습니다" }, 502);
  }

  const confidence =
    parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "low";
  const estimate = {
    center_x_norm: Math.min(0.92, Math.max(0.08, Number(parsed.center_x_norm) || 0.5)),
    center_y_norm: Math.min(0.92, Math.max(0.08, Number(parsed.center_y_norm) || 0.5)),
    width_frac: Math.min(0.95, Math.max(0.08, Number(parsed.width_frac) || 0.45)),
    rotation_deg: Number.isFinite(Number(parsed.rotation_deg))
      ? ((Number(parsed.rotation_deg) + 540) % 360) - 180
      : 0,
    confidence,
    landmarks_matched: Array.isArray(parsed.landmarks_matched)
      ? parsed.landmarks_matched.map((s) => String(s)).filter(Boolean).slice(0, 5)
      : [],
    reason: typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : "주변 도로·지형을 기준으로 4자유도 초안을 추정했습니다.",
  };

  const corners = estimateToCorners(bbox, estimate, aspectRatio);
  return jsonResp({
    corners,
    bbox,
    satellite_source: sat.source,
    estimate,
  });
});
