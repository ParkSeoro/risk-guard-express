// Phase 3 (v3): Server-side AI RoadMap+Satellite ↔ Drone 4-DOF Draft Alignment.
// Fetches BOTH crisp Road/Railway/Bridge Map (unblurred even in Korean industrial
// security zones!) AND Satellite imagery for the exact same WGS-84 bbox, then uses
// Gemini 2.5 Pro/Flash (primary when GEMINI_API_KEY is valid) with GPT-4o fallback
// to compute an UNSAVED 4-DOF preview (zero skew/distortion).
// Never modifies DB, attendance spots, or gps_calibration.
// JWT is validated internally via userClient.auth.getUser() (verify_jwt = false).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { resolveGeminiApiKey } from "../_shared/geminiNative.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL_TIMEOUT_MS = 35_000;
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

type ImgData = { base64: string; mimeType: string };

async function fetchImageAsBase64(url: string): Promise<ImgData | null> {
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

async function fetchReferenceMaps(
  bbox: SatelliteBbox,
  centerLat: number,
  centerLng: number,
  vworldKey?: string,
): Promise<{ road: ImgData | null; sat: ImgData | null; source: "vworld" | "esri" }> {
  const bboxParam = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const esriRoadUrl =
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export` +
    `?bbox=${bboxParam}&bboxSR=4326&imageSR=4326&size=768,768&format=jpg&f=image`;
  const esriSatUrl =
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export` +
    `?bbox=${bboxParam}&bboxSR=4326&imageSR=4326&size=768,768&format=jpg&f=image`;

  const [esriRoad, esriSat] = await Promise.all([
    fetchImageAsBase64(esriRoadUrl),
    fetchImageAsBase64(esriSatUrl),
  ]);

  if (esriRoad || esriSat) {
    return { road: esriRoad, sat: esriSat, source: "esri" };
  }

  const key = (vworldKey || Deno.env.get("VWORLD_API_KEY") || "").trim();
  if (key) {
    const vwRoadUrl =
      `https://api.vworld.kr/req/image?service=image&request=getmap&version=2.0` +
      `&crs=epsg:4326&bbox=${bboxParam}&center=${centerLng},${centerLat}&size=768,768&format=png&basemap=GRAPHIC&key=${encodeURIComponent(key)}`;
    const vwSatUrl =
      `https://api.vworld.kr/req/image?service=image&request=getmap&version=2.0` +
      `&crs=epsg:4326&bbox=${bboxParam}&center=${centerLng},${centerLat}&size=768,768&format=jpeg&basemap=PHOTO&key=${encodeURIComponent(key)}`;
    const [vwRoad, vwSat] = await Promise.all([
      fetchImageAsBase64(vwRoadUrl),
      fetchImageAsBase64(vwSatUrl),
    ]);
    return { road: vwRoad, sat: vwSat, source: "vworld" };
  }
  return { road: null, sat: null, source: "esri" };
}

function buildPrompt(bboxWidthM: number, aspectRatio: number, hasRoad: boolean): string {
  return `당신은 건설현장 드론 정사사진을 기준 지도(진북 North-up) 위에 4자유도(중심 위치·크기·회전, 왜곡 없음)로 정밀 정렬하는 공간영상 측량 전문가 AI입니다.

[입력 이미지]
${hasRoad ? "- Image 1 (핵심 기준 — 도로·철도·교량·수로 지도): 진북(North-up), 전체 가로폭 약 " + Math.round(bboxWidthM) + "m. 국내 산단 지역은 위성사진에 보안 블러가 있으므로 반드시 이 도로지도의 도로 방향·교차로·교량·철도·하천 선형을 1순위 기준으로 삼으세요.\n" : ""}- Image ${hasRoad ? "2" : "1"} (위성 지도): Image 1과 완전히 동일한 영역(진북 North-up, 전체 가로폭 약 ${Math.round(bboxWidthM)}m).
- Image ${hasRoad ? "3" : "2"} (드론 현장사진): 정렬 대상 사진 (가로/세로 비율 ${aspectRatio.toFixed(2)}:1). 드론 기체 방향에 따라 북쪽이 위가 아니라 크게 회전(-180°~+180°)되어 있을 수 있습니다!

[필수 추론 절차 — 반드시 순서대로 계산]
1. 먼저 드론 사진 안에서 가장 길고 뚜렷한 직선 구조물(인접 도로, 철도, 하천/수로, 교량, 부지 외곽 담장)의 방향(예: 가로 0°, 대각선 등)을 파악하세요.
2. 기준 도로지도(Image 1)에서 같은 도로/철도/하천이 진북 기준으로 몇 도 기울어져 있는지 측정하세요.
   - 예: 기준 지도에서 주 도로가 남서→북동(약 40°~50° 기울기)인데, 드론 사진에서는 그 도로가 수평(0°)에 가깝게 보인다면, 드론 사진을 **반시계방향(-40°~-50°)**으로 회전해야 일치합니다!
   - 반대로 시계방향으로 돌려야 일치하면 양수(+각도), 반시계방향으로 돌려야 일치하면 음수(-각도)를 출력하세요.
3. 절대 기본값(rotation_deg=0, center=0.5/0.5)을 습관적으로 출력하지 말고, 실제 도로·교량·수로의 기하학적 각도와 길이를 재서 답하세요.
4. 드론 사진의 실제 가로 폭(미터)이 기준 지도 전체 폭(${Math.round(bboxWidthM)}m) 중 차지하는 비율(width_frac)을 도로 간격/교량 길이로 추정하세요.

반드시 아래 JSON 객체 하나만 출력하세요 (코드블록·설명 금지):
{
  "center_x_norm": 0.48,
  "center_y_norm": 0.52,
  "width_frac": 0.55,
  "rotation_deg": -42,
  "confidence": "high" | "medium" | "low",
  "landmarks_matched": ["매칭한 도로/교량/철도/수로 특징 2~3개 (한국어)"],
  "reason": "도로 각도와 기준점 매칭 근거 1줄 요약 (한국어)"
}`;
}

async function callGeminiVision(
  prompt: string,
  road: ImgData | null,
  sat: ImgData | null,
  drone: ImgData,
): Promise<{ text: string; model: string } | null> {
  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) return null;

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  let idx = 1;
  if (road) {
    parts.push({ text: `[Image ${idx++}: Road/Railway/Bridge Reference Map (North-up)]` });
    parts.push({ inline_data: { mime_type: road.mimeType, data: road.base64 } });
  }
  if (sat) {
    parts.push({ text: `[Image ${idx++}: Satellite Reference (North-up)]` });
    parts.push({ inline_data: { mime_type: sat.mimeType, data: sat.base64 } });
  }
  parts.push({ text: `[Image ${idx}: Drone Site Photo to Align]` });
  parts.push({ inline_data: { mime_type: drone.mimeType, data: drone.base64 } });

  const models = [
    (Deno.env.get("GEMINI_VISION_MODEL") || "gemini-2.5-flash").trim(),
    "gemini-3.1-pro-preview",
  ];
  const uniqueModels = Array.from(new Set(models));

  for (const model of uniqueModels) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 512 },
          },
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn(`[align-site-map-ai] Gemini(${model}) error:`, res.status, errText.slice(0, 200));
        if (res.status === 400 && errText.includes("API_KEY_INVALID")) break;
        continue;
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return { text, model };
    } catch (err) {
      console.warn(`[align-site-map-ai] Gemini(${model}) exception:`, err);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function callOpenAiVision(
  prompt: string,
  road: ImgData | null,
  sat: ImgData | null,
  drone: ImgData,
): Promise<{ text: string; model: string } | null> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
  if (!apiKey) return null;
  const baseUrl = (Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  // Use full gpt-4o for spatial rotation/scale accuracy (gpt-4o-mini defaults to 0 deg)
  const model = "gpt-4o";

  const content: Record<string, unknown>[] = [{ type: "text", text: prompt }];
  let idx = 1;
  if (road) {
    content.push({ type: "text", text: `[Image ${idx++}: Road/Railway/Bridge Reference Map (North-up)]` });
    content.push({ type: "image_url", image_url: { url: `data:${road.mimeType};base64,${road.base64}`, detail: "high" } });
  }
  if (sat) {
    content.push({ type: "text", text: `[Image ${idx++}: Satellite Reference (North-up)]` });
    content.push({ type: "image_url", image_url: { url: `data:${sat.mimeType};base64,${sat.base64}`, detail: "high" } });
  }
  content.push({ type: "text", text: `[Image ${idx}: Drone Site Photo to Align]` });
  content.push({ type: "image_url", image_url: { url: `data:${drone.mimeType};base64,${drone.base64}`, detail: "high" } });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      console.warn("[align-site-map-ai] OpenAI(gpt-4o) error:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return text ? { text, model } : null;
  } catch (err) {
    console.warn("[align-site-map-ai] OpenAI exception:", err);
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
  const [refs, drone] = await Promise.all([
    fetchReferenceMaps(bbox, centerLat, centerLng, body.vworld_key),
    fetchImageAsBase64(droneUrl),
  ]);

  if (!refs.road && !refs.sat) {
    return jsonResp({ error: "기준 지도를 불러오지 못했습니다. 잠시 후 다시 시도하세요." }, 502);
  }
  if (!drone) {
    return jsonResp({ error: "드론 도면 이미지를 불러오지 못했습니다 (4.5MB 이하 이미지만 지원)." }, 400);
  }

  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.1);
  const bboxWidthM = (bbox.east - bbox.west) * 111_320 * cosLat;
  const prompt = buildPrompt(bboxWidthM, aspectRatio, Boolean(refs.road));

  // Gemini 2.5 Pro/Flash primary -> GPT-4o high-accuracy fallback
  const aiRes =
    (await callGeminiVision(prompt, refs.road, refs.sat, drone)) ??
    (await callOpenAiVision(prompt, refs.road, refs.sat, drone));

  if (!aiRes) {
    return jsonResp({ error: "AI 영상 비교 분석에 실패했습니다. 2점 기준점 맞춤이나 모바일 워킹 보정을 이용해 주세요." }, 502);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripMarkdownFences(aiRes.text));
  } catch {
    const num = (key: string): number | null => {
      const m = aiRes.text.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
      return m ? Number(m[1]) : null;
    };
    const cx = num("center_x_norm");
    const cy = num("center_y_norm");
    const wf = num("width_frac");
    const rot = num("rotation_deg");
    if (cx != null && cy != null && wf != null && rot != null) {
      const confM = aiRes.text.match(/"confidence"\s*:\s*"(high|medium|low)"/);
      parsed = {
        center_x_norm: cx,
        center_y_norm: cy,
        width_frac: wf,
        rotation_deg: rot,
        confidence: confM ? confM[1] : "medium",
        landmarks_matched: [],
        reason: "도로·지형 기준 4자유도 초안을 추출했습니다.",
      };
    } else {
      console.warn("[align-site-map-ai] JSON parse failed:", aiRes.model, aiRes.text.slice(0, 200));
      return jsonResp({ error: "AI 응답 형식을 해석하지 못했습니다" }, 502);
    }
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
      ? `${parsed.reason.trim()} (${aiRes.model})`
      : `도로·지형 기준으로 4자유도 초안을 추정했습니다 (${aiRes.model}).`,
  };

  const corners = estimateToCorners(bbox, estimate, aspectRatio);
  return jsonResp({
    corners,
    bbox,
    satellite_source: refs.source,
    model: aiRes.model,
    estimate,
  });
});
