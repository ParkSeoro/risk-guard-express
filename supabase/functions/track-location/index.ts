// Authoritative location → zone resolver.
// Runs server-side so a malicious client cannot fake which zone they entered.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  project_id: z.string().uuid(),
  worker_id: z.string().uuid().optional().nullable(),
  worker_qr_id: z.string().uuid().optional().nullable(),
  worker_name: z.string().max(120).optional().nullable(),
  worker_phone: z.string().max(40).optional().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(5000).optional().default(0),
  wifi_scan: z
    .array(z.object({ bssid: z.string(), rssi: z.number(), ssid: z.string().optional() }))
    .optional()
    .default([]),
  device_ts: z.string().optional(),
});

function pointInPolygon(lng: number, lat: number, poly: { lat: number; lng: number }[]) {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat;
    const xj = poly[j].lng, yj = poly[j].lat;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function cosineSimilarity(
  scan: { bssid: string; rssi: number }[],
  fp: { bssid: string; avg_rssi: number }[]
): number {
  const norm = (r: number) => Math.max(0, Math.min(1, (r + 100) / 70));
  const a = new Map<string, number>();
  scan.forEach((s) => a.set(s.bssid.toLowerCase(), norm(s.rssi)));
  const b = new Map<string, number>();
  fp.forEach((f) => b.set(f.bssid.toLowerCase(), norm(f.avg_rssi)));
  const keys = new Set([...a.keys(), ...b.keys()]);
  let dot = 0, sa = 0, sb = 0;
  for (const k of keys) {
    const av = a.get(k) ?? 0, bv = b.get(k) ?? 0;
    dot += av * bv; sa += av * av; sb += bv * bv;
  }
  return sa && sb ? dot / Math.sqrt(sa * sb) : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;

    // Reject obviously bad fixes when there is also no Wi-Fi signal to fall back on.
    if (body.accuracy_m > 100 && (!body.wifi_scan || body.wifi_scan.length === 0)) {
      return new Response(
        JSON.stringify({ zone_id: null, source: null, event_type: null, ignored: "low_accuracy" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load zones in this project
    const { data: zones, error: zErr } = await supabase
      .from("site_zones")
      .select("id, name, zone_type, geo_polygon, wifi_fingerprint")
      .eq("project_id", body.project_id)
      .eq("is_deleted", false);
    if (zErr) throw zErr;

    // 1) GPS geofence
    let matchedZoneId: string | null = null;
    let source: "gps" | "wifi" = "gps";

    if (body.accuracy_m <= 50) {
      for (const z of zones || []) {
        if (z.geo_polygon && pointInPolygon(body.lng, body.lat, z.geo_polygon as any)) {
          matchedZoneId = z.id;
          break;
        }
      }
    }

    // 2) Wi-Fi fingerprint fallback
    if (!matchedZoneId && body.wifi_scan?.length) {
      let best: { id: string; score: number } | null = null;
      for (const z of zones || []) {
        const fp = (z.wifi_fingerprint as any[]) || [];
        if (!fp.length) continue;
        const score = cosineSimilarity(body.wifi_scan, fp);
        if (!best || score > best.score) best = { id: z.id, score };
      }
      if (best && best.score >= 0.6) {
        matchedZoneId = best.id;
        source = "wifi";
      }
    }

    // Decide event type vs last event for this worker today
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const workerKey = body.worker_qr_id
      ? { col: "worker_qr_id", val: body.worker_qr_id }
      : body.worker_phone
      ? { col: "worker_phone", val: body.worker_phone }
      : null;

    let lastEvent: any = null;
    if (workerKey) {
      const { data } = await supabase
        .from("worker_zone_events")
        .select("zone_id, event_type")
        .eq("project_id", body.project_id)
        .eq(workerKey.col, workerKey.val)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      lastEvent = data?.[0] ?? null;
    }

    const zoneMeta = (zones || []).find((z) => z.id === matchedZoneId);
    let eventType: string | null = null;

    if (matchedZoneId && matchedZoneId !== lastEvent?.zone_id) {
      // entered a new zone
      eventType =
        zoneMeta?.zone_type === "danger" || zoneMeta?.zone_type === "restricted"
          ? "unauthorized_entry"
          : "entry";
    } else if (!matchedZoneId && lastEvent?.zone_id) {
      // left previous zone
      eventType = "exit";
    }

    if (eventType) {
      await supabase.from("worker_zone_events").insert({
        project_id: body.project_id,
        zone_id: matchedZoneId ?? lastEvent?.zone_id ?? null,
        worker_qr_id: body.worker_qr_id ?? null,
        worker_name: body.worker_name ?? null,
        worker_phone: body.worker_phone ?? null,
        event_type: eventType,
        source,
        lat: body.lat,
        lng: body.lng,
        accuracy_m: body.accuracy_m,
      });

      // 위험/제한구역 무단진입 시 실시간 푸시 알람 발송
      if (eventType === "unauthorized_entry") {
        try {
          await dispatchDangerZonePush(supabase, {
            project_id: body.project_id,
            zone_name: zoneMeta?.name ?? "위험구역",
            zone_type: zoneMeta?.zone_type ?? "danger",
            worker_name: body.worker_name ?? null,
            worker_phone: body.worker_phone ?? null,
            worker_qr_id: body.worker_qr_id ?? null,
            zone_id: matchedZoneId,
          });
        } catch (pushErr) {
          console.warn("[track-location] push dispatch failed", pushErr);
        }
      }
    }


    return new Response(
      JSON.stringify({ zone_id: matchedZoneId, source, event_type: eventType }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ---------------------------------------------------------------------------
// 위험구역 침범 시 실시간 푸시 알람 발송
// - 침범한 근로자 본인: workers.phone → profiles.phone → user_id 매핑
// - 프로젝트 안전관리자/현장소장: project_members.position_new IN
//   ('SITE_MANAGER','HSE_MANAGER','OWNER_HSE','SUPERVISOR')
// send-push edge function 을 service-role 로 호출하여 web-push 발송,
// notifications 테이블에도 기록해 인앱 벨/모바일 알림함에 반영.
// ---------------------------------------------------------------------------
async function dispatchDangerZonePush(
  supabase: ReturnType<typeof createClient>,
  ctx: {
    project_id: string;
    zone_id: string | null;
    zone_name: string;
    zone_type: string;
    worker_name: string | null;
    worker_phone: string | null;
    worker_qr_id: string | null;
  }
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 근로자 표시 이름 확정 (workers 테이블 우선)
  let displayName = ctx.worker_name;
  if (!displayName && ctx.worker_qr_id) {
    const { data: w } = await supabase
      .from("workers")
      .select("name, phone")
      .eq("id", ctx.worker_qr_id)
      .maybeSingle();
    if (w) {
      displayName = displayName || (w as any).name;
      if (!ctx.worker_phone) ctx.worker_phone = (w as any).phone ?? null;
    }
  }
  displayName = displayName || "근로자";

  // 1) 대상 user_id 수집
  const targets = new Map<string, "worker" | "manager">();

  // (a) 침범 당사자 - phone 으로 profiles 매핑
  if (ctx.worker_phone) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("phone", ctx.worker_phone)
      .maybeSingle();
    const uid = (prof as any)?.user_id;
    if (uid) targets.set(uid, "worker");
  }

  // (b) 프로젝트 관리자
  const { data: mgrs } = await supabase
    .from("project_members")
    .select("user_id, position_new")
    .eq("project_id", ctx.project_id)
    .in("position_new", ["SITE_MANAGER", "HSE_MANAGER", "OWNER_HSE", "SUPERVISOR"]);
  for (const m of (mgrs as any[]) || []) {
    if (m.user_id && !targets.has(m.user_id)) targets.set(m.user_id, "manager");
  }

  if (targets.size === 0) return;

  const zoneLabel = ctx.zone_type === "restricted" ? "제한구역" : "위험구역";
  const workerTitle = `⚠️ ${zoneLabel} 진입 경고`;
  const workerBody = `${ctx.zone_name}에 진입했습니다. 즉시 이탈하십시오.`;
  const managerTitle = `🚨 ${zoneLabel} 무단진입 발생`;
  const managerBody = `${displayName} 근로자가 ${ctx.zone_name}에 진입했습니다.`;
  const url = `/zone-events?project=${ctx.project_id}`;

  // 2) 인앱 알림 (notifications 테이블) 일괄 insert
  const notiRows = Array.from(targets.entries()).map(([user_id, kind]) => ({
    user_id,
    project_id: ctx.project_id,
    type: "danger_zone_entry",
    title: kind === "worker" ? workerTitle : managerTitle,
    message: kind === "worker" ? workerBody : managerBody,
    related_type: "zone_event",
    related_id: ctx.zone_id,
    is_read: false,
    priority: "high",
  }));
  try {
    await supabase.from("notifications").insert(notiRows);
  } catch (e) {
    console.warn("[track-location] notifications insert failed", e);
  }

  // 3) Web Push 발송 (send-push edge function, service-role 인증)
  await Promise.all(
    Array.from(targets.entries()).map(async ([user_id, kind]) => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            user_id,
            title: kind === "worker" ? workerTitle : managerTitle,
            body: kind === "worker" ? workerBody : managerBody,
            url,
            tag: `danger-zone-${ctx.zone_id ?? "x"}`,
            related_type: "zone_event",
            related_id: ctx.zone_id ?? undefined,
          }),
        });
        if (!res.ok) {
          console.warn(
            `[track-location] send-push ${kind} ${user_id} → ${res.status}: ${await res.text()}`
          );
        }
      } catch (e) {
        console.warn(`[track-location] send-push ${kind} ${user_id} error`, e);
      }
    })
  );
}

