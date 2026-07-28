// Authoritative location → zone resolver.
// Runs server-side so a malicious client cannot fake which zone they entered.
// Also evaluates restricted_zones (polygon/radius + ban targets) for voice/push alerts.

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
  /** Optional role code for alarm honorific (master / project_admin / worker …) */
  worker_role: z.string().max(64).optional().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(5000).optional().default(0),
  wifi_scan: z
    .array(z.object({ bssid: z.string(), rssi: z.number(), ssid: z.string().optional() }))
    .optional()
    .default([]),
  device_ts: z.string().optional(),
  restricted_zone_id: z.string().uuid().optional().nullable(),
  force_restricted_check: z.boolean().optional().default(false),
});

function roleHonorific(role: string | null | undefined): string {
  const r = String(role || "").trim().toLowerCase();
  if (r === "admin" || r === "manager" || r === "master" || r === "project_admin") return "관리자님";
  if (r === "safety_manager") return "안전관리자님";
  if (r === "site_manager") return "현장소장님";
  if (r === "supervisor") return "감리님";
  if (r === "site_supervisor") return "관리감독자님";
  if (r === "viewer") return "열람자";
  if (r === "worker" || r === "contractor" || r === "user") return "근로자";
  return "";
}

function notesWithRole(base: string | null | undefined, role: string | null | undefined): string | null {
  const label = roleHonorific(role);
  const cleaned = String(base || "").replace(/\s*\|?\s*role_label=[^\s|]*/g, "").trim();
  if (!label) return cleaned || null;
  return cleaned ? `${cleaned} | role_label=${label}` : `role_label=${label}`;
}

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

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
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

function isBanned(
  zone: {
    banned_worker_ids?: string[] | null;
    banned_company_ids?: string[] | null;
    banned_job_types?: string[] | null;
  },
  subject: { worker_id?: string | null; company_id?: string | null; job_type?: string | null }
) {
  const workers = zone.banned_worker_ids || [];
  const companies = zone.banned_company_ids || [];
  const jobs = (zone.banned_job_types || []).map((j) => j.trim().toLowerCase()).filter(Boolean);
  if (workers.length === 0 && companies.length === 0 && jobs.length === 0) return true;
  if (subject.worker_id && workers.includes(subject.worker_id)) return true;
  if (subject.company_id && companies.includes(subject.company_id)) return true;
  if (subject.job_type && jobs.includes(subject.job_type.trim().toLowerCase())) return true;
  return false;
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

    if (body.accuracy_m > 100 && (!body.wifi_scan || body.wifi_scan.length === 0) && !body.force_restricted_check) {
      return new Response(
        JSON.stringify({ zone_id: null, source: null, event_type: null, ignored: "low_accuracy" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve worker subject for ban matching
    let subject = {
      worker_id: body.worker_id || body.worker_qr_id || null,
      company_id: null as string | null,
      job_type: null as string | null,
    };
    const workerLookupId = body.worker_id || body.worker_qr_id;
    if (workerLookupId) {
      const { data: w } = await supabase
        .from("workers")
        .select("id, company_id, job_type, name, phone")
        .eq("id", workerLookupId)
        .maybeSingle();
      if (w) {
        subject = { worker_id: w.id, company_id: w.company_id, job_type: w.job_type };
        if (!body.worker_name) body.worker_name = w.name;
        if (!body.worker_phone) body.worker_phone = w.phone;
      }
    } else if (body.worker_phone) {
      const { data: w } = await supabase
        .from("workers")
        .select("id, company_id, job_type, name, phone")
        .eq("project_id", body.project_id)
        .eq("phone", body.worker_phone)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (w) {
        subject = { worker_id: w.id, company_id: w.company_id, job_type: w.job_type };
        if (!body.worker_name) body.worker_name = w.name;
      }
    }

    // ---- restricted_zones (primary for voice/push ban targeting) ----
    const { data: rZones } = await supabase
      .from("restricted_zones")
      .select(
        "id, name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, banned_worker_ids, banned_company_ids, banned_job_types"
      )
      .eq("project_id", body.project_id)
      .eq("is_deleted", false)
      .eq("is_active", true);

    let matchedRestricted: any = null;
    if (body.restricted_zone_id) {
      matchedRestricted = (rZones || []).find((z: any) => z.id === body.restricted_zone_id) || null;
      if (matchedRestricted && !isBanned(matchedRestricted, subject)) matchedRestricted = null;
    } else {
      for (const z of rZones || []) {
        let inside = false;
        if (z.geometry_type === "radius") {
          if (z.center_lat != null && z.center_lng != null && z.radius_m) {
            inside =
              haversineM(body.lat, body.lng, Number(z.center_lat), Number(z.center_lng)) <=
              Number(z.radius_m);
          }
        } else if (z.geo_polygon) {
          inside = pointInPolygon(body.lng, body.lat, z.geo_polygon as any);
        }
        if (inside && isBanned(z, subject)) {
          matchedRestricted = z;
          break;
        }
      }
    }

    // ---- legacy site_zones ----
    const { data: zones, error: zErr } = await supabase
      .from("site_zones")
      .select("id, name, zone_type, geo_polygon, wifi_fingerprint")
      .eq("project_id", body.project_id)
      .eq("is_deleted", false);
    if (zErr) throw zErr;

    let matchedZoneId: string | null = null;
    let source: "gps" | "wifi" | "restricted" = "gps";

    if (body.accuracy_m <= 50 || body.force_restricted_check) {
      for (const z of zones || []) {
        if (z.geo_polygon && pointInPolygon(body.lng, body.lat, z.geo_polygon as any)) {
          matchedZoneId = z.id;
          break;
        }
      }
    }

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

    if (matchedRestricted) source = "restricted";

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const workerKey = body.worker_qr_id
      ? { col: "worker_qr_id", val: body.worker_qr_id }
      : body.worker_phone
      ? { col: "worker_phone", val: body.worker_phone }
      : subject.worker_id
      ? null
      : null;

    let lastEvent: any = null;
    if (workerKey) {
      const { data } = await supabase
        .from("worker_zone_events")
        .select("zone_id, event_type, restricted_zone_id")
        .eq("project_id", body.project_id)
        .eq(workerKey.col, workerKey.val)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      lastEvent = data?.[0] ?? null;
    } else if (subject.worker_id) {
      const { data } = await supabase
        .from("worker_zone_events")
        .select("zone_id, event_type, restricted_zone_id")
        .eq("project_id", body.project_id)
        .eq("worker_name", body.worker_name || "")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      lastEvent = data?.[0] ?? null;
    }

    const zoneMeta = (zones || []).find((z) => z.id === matchedZoneId);
    let eventType: string | null = null;

    // Restricted zone unauthorized entry (ban match)
    if (
      matchedRestricted &&
      matchedRestricted.id !== lastEvent?.restricted_zone_id
    ) {
      eventType = "unauthorized_entry";
    } else if (matchedZoneId && matchedZoneId !== lastEvent?.zone_id) {
      eventType =
        zoneMeta?.zone_type === "danger" || zoneMeta?.zone_type === "restricted"
          ? "unauthorized_entry"
          : "entry";
    } else if (
      !matchedZoneId &&
      !matchedRestricted &&
      (lastEvent?.zone_id || lastEvent?.restricted_zone_id)
    ) {
      eventType = "exit";
    }

    if (eventType) {
      await supabase.from("worker_zone_events").insert({
        project_id: body.project_id,
        zone_id: matchedZoneId ?? lastEvent?.zone_id ?? null,
        restricted_zone_id:
          matchedRestricted?.id ??
          (eventType === "exit" ? lastEvent?.restricted_zone_id : null) ??
          null,
        worker_qr_id: body.worker_qr_id ?? subject.worker_id ?? null,
        worker_name: body.worker_name ?? null,
        worker_phone: body.worker_phone ?? null,
        event_type: eventType,
        source,
        notes: notesWithRole(null, body.worker_role),
        lat: body.lat,
        lng: body.lng,
        accuracy_m: body.accuracy_m,
      });
    }

    return new Response(
      JSON.stringify({
        zone_id: matchedZoneId,
        restricted_zone_id: matchedRestricted?.id ?? null,
        zone_name: matchedRestricted?.name || zoneMeta?.name || null,
        zone_type: matchedRestricted
          ? "danger"
          : zoneMeta?.zone_type || null,
        source,
        event_type: eventType,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
