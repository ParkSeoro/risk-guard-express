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
