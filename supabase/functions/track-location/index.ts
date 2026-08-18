// Authoritative location → zone resolver.
// Runs server-side so a malicious client cannot fake which zone they entered.
// Also evaluates restricted_zones (polygon/radius + ban targets) for voice/push alerts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { isAccessForbidden } from "../_shared/accessRules.ts";
import { applyGpsCalibration, parseGpsCalibration } from "../_shared/gpsCalibration.ts";
import {
  digitsOnlyPhone,
  resolveZoneEventWorkerKey,
  shouldIgnoreLowAccuracyFix,
  SITE_ZONE_MATCH_MAX_ACCURACY_M,
  trackIdentityClaimMismatch,
  zoneEventLookbackSince,
} from "../_shared/trackLocationIdentity.ts";

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
  /** Membership company hint (masters often have no workers row) — ignored for writes; JWT wins */
  company_id: z.string().uuid().optional().nullable(),
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
  /** Names a unified zone; must not skip the accuracy discard gate. */
  force_restricted_check: z.boolean().optional().default(false),
  /** Master off-site alarm test: evaluate zones, do not upsert worker_last_positions. */
  suppress_last_position: z.boolean().optional().default(false),
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
    access_rules?: unknown;
    rule_type?: string | null;
    banned_worker_ids?: string[] | null;
    banned_company_ids?: string[] | null;
    banned_job_types?: string[] | null;
  },
  subject: { worker_id?: string | null; company_id?: string | null; job_type?: string | null }
) {
  return isAccessForbidden(zone.access_rules, subject, {
    banned_worker_ids: zone.banned_worker_ids,
    banned_company_ids: zone.banned_company_ids,
    banned_job_types: zone.banned_job_types,
    rule_type: zone.rule_type,
  });
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
    const rawLat = body.lat;
    const rawLng = body.lng;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceKey;

    // Require end-user JWT — body identity alone must not author zone events / last_positions.
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bearer = authHeader.slice(7).trim();
    if (!bearer || bearer === serviceKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userSb.auth.getUser();
    const uid = userData?.user?.id;
    if (userErr || !uid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (shouldIgnoreLowAccuracyFix(body.accuracy_m, body.wifi_scan?.length ?? 0)) {
      return new Response(
        JSON.stringify({ zone_id: null, source: null, event_type: null, ignored: "low_accuracy" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const [{ data: isMaster }, { data: isMember }] = await Promise.all([
      supabase.rpc("is_master", { _user_id: uid }),
      supabase.rpc("is_project_member", { _user_id: uid, _project_id: body.project_id }),
    ]);
    if (!isMaster && !isMember) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Project GPS bias (master 1-point field align). Clients send RAW GPS.
    {
      const { data: proj } = await supabase
        .from("projects")
        .select("gps_calibration")
        .eq("id", body.project_id)
        .maybeSingle();
      const cal = parseGpsCalibration(proj?.gps_calibration);
      const fixed = applyGpsCalibration(body.lat, body.lng, cal);
      body.lat = fixed.lat;
      body.lng = fixed.lng;
    }

    // Resolve subject from JWT profile + roster — never trust body worker/company for writes.
    //
    // 403 Identity mismatch: body worker_id/phone is proven to be someone else.
    // Not 403: no roster row (manager/master) or empty claims — server fills,
    // worker_id may be null. A failed page-scan lookup must not look like impersonation.
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone, display_name")
      .eq("user_id", uid)
      .maybeSingle();
    const profilePhoneDigits = digitsOnlyPhone(profile?.phone);

    const { data: pm } = await supabase
      .from("project_members")
      .select("company_id, role_new")
      .eq("project_id", body.project_id)
      .eq("user_id", uid)
      .maybeSingle();

    let resolvedWorker: {
      id: string;
      company_id: string | null;
      job_type: string | null;
      name: string | null;
      phone: string | null;
    } | null = null;

    if (profile?.phone) {
      const { data: found } = await supabase.rpc("lookup_project_worker_by_phone", {
        _project_id: body.project_id,
        _phone: profile.phone,
      });
      const row = Array.isArray(found) ? found[0] : found;
      if (row?.id) {
        resolvedWorker = {
          id: row.id,
          company_id: row.company_id ?? null,
          job_type: row.job_type ?? null,
          name: row.name ?? null,
          phone: row.phone ?? null,
        };
      }
    }

    const claimedWorkerId = body.worker_id || body.worker_qr_id || null;
    if (
      trackIdentityClaimMismatch({
        profilePhoneDigits,
        resolvedWorkerId: resolvedWorker?.id ?? null,
        resolvedWorkerPhoneDigits: digitsOnlyPhone(resolvedWorker?.phone),
        claimedWorkerId,
        claimedWorkerPhone: body.worker_phone,
      })
    ) {
      return new Response(
        JSON.stringify({ error: "Identity mismatch: body worker does not match authenticated user" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const subject = {
      worker_id: resolvedWorker?.id ?? null,
      company_id: resolvedWorker?.company_id || pm?.company_id || null,
      job_type: resolvedWorker?.job_type ?? null,
    };

    body.worker_name =
      resolvedWorker?.name ||
      profile?.display_name ||
      body.worker_name ||
      null;
    body.worker_phone = resolvedWorker?.phone || profile?.phone || null;
    if (pm?.role_new) body.worker_role = pm.role_new;
    // Keep event keys consistent with resolved roster id (QR-only identity retired).
    if (resolvedWorker?.id) {
      body.worker_id = resolvedWorker.id;
      body.worker_qr_id = resolvedWorker.id;
    } else {
      body.worker_id = null;
      body.worker_qr_id = null;
    }

    // ---- restricted_zones (primary for voice/push ban targeting) ----
    const { data: rZones } = await supabase
      .from("restricted_zones")
      .select(
        "id, name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, banned_worker_ids, banned_company_ids, banned_job_types, access_rules, rule_type, zone_category, zone_color"
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

    // ---- legacy site_zones (site enter/exit + QR). GPS sirens SSOT is restricted_zones. ----
    const { data: zones, error: zErr } = await supabase
      .from("site_zones")
      .select("id, name, zone_type, geo_polygon, wifi_fingerprint")
      .eq("project_id", body.project_id)
      .eq("is_deleted", false);
    if (zErr) throw zErr;

    const { count: everUnified } = await supabase
      .from("restricted_zones")
      .select("id", { count: "exact", head: true })
      .eq("project_id", body.project_id);
    // Policy: src/lib/tracking/zoneAlarmPolicy.ts
    const unifiedSsot = (everUnified ?? 0) > 0;

    let matchedZoneId: string | null = null;
    let source: "gps" | "wifi" | "restricted" = "gps";

    if (body.accuracy_m <= SITE_ZONE_MATCH_MAX_ACCURACY_M) {
      for (const z of zones || []) {
        // After the unified map is used, leftover Site Maps danger/restricted
        // polygons must not keep matching — they survived add/edit/delete there.
        if (
          unifiedSsot &&
          (z.zone_type === "danger" || z.zone_type === "restricted")
        ) {
          continue;
        }
        if (z.geo_polygon && pointInPolygon(body.lng, body.lat, z.geo_polygon as any)) {
          matchedZoneId = z.id;
          break;
        }
      }
    }

    if (!matchedZoneId && body.wifi_scan?.length) {
      let best: { id: string; score: number } | null = null;
      for (const z of zones || []) {
        if (
          unifiedSsot &&
          (z.zone_type === "danger" || z.zone_type === "restricted")
        ) {
          continue;
        }
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

    const since = zoneEventLookbackSince();
    const workerKey = resolveZoneEventWorkerKey({
      workerQrId: body.worker_qr_id,
      workerPhone: body.worker_phone,
      workerId: subject.worker_id,
    });

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
    }

    const zoneMeta = (zones || []).find((z) => z.id === matchedZoneId);
    let eventType: string | null = null;
    const lastWasExit =
      !!lastEvent && /^(exit|leave|depart)/i.test(String(lastEvent.event_type || ""));
    const lastRestrictedId = lastWasExit ? null : lastEvent?.restricted_zone_id ?? null;
    const lastSiteId = lastWasExit ? null : lastEvent?.zone_id ?? null;

    // Restricted zone unauthorized entry (ban match) — unified map SSOT
    if (matchedRestricted && matchedRestricted.id !== lastRestrictedId) {
      eventType = "unauthorized_entry";
    } else if (matchedZoneId && matchedZoneId !== lastSiteId) {
      const legacyDanger =
        zoneMeta?.zone_type === "danger" || zoneMeta?.zone_type === "restricted";
      // Never siren from leftover site_zones once restricted_zones exist.
      eventType = legacyDanger && !unifiedSsot ? "unauthorized_entry" : "entry";
    } else if (!matchedZoneId && !matchedRestricted && (lastRestrictedId || lastSiteId)) {
      eventType = "exit";
    }

    let eventInsertError: string | null = null;
    if (eventType) {
      const { error: wzeErr } = await supabase.from("worker_zone_events").insert({
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
      if (wzeErr) {
        eventInsertError = wzeErr.message || String(wzeErr);
        console.error("[track-location] worker_zone_events insert failed", {
          code: wzeErr.code,
          message: wzeErr.message,
          details: wzeErr.details,
          hint: wzeErr.hint,
          event_type: eventType,
          worker_qr_id: body.worker_qr_id ?? subject.worker_id ?? null,
          project_id: body.project_id,
        });
      }
    }

    // Always refresh last-known position when we can identify the worker.
    // Distribution map aggregates from this table (company/zone/count only).
    // Coalesce: skip upsert if same zone and moved <5m within 8s (cut write amplification).
    // suppress_last_position: master off-site alarm test must not appear on the map.
    if (subject.worker_id && !body.suppress_last_position) {
      const lastZone =
        eventType === "exit"
          ? null
          : matchedZoneId ?? lastEvent?.zone_id ?? null;

      let skipUpsert = false;
      if (!eventType) {
        const { data: prevPos } = await supabase
          .from("worker_last_positions")
          .select("lat, lng, zone_id, updated_at")
          .eq("worker_id", subject.worker_id)
          .maybeSingle();
        if (prevPos?.updated_at) {
          const ageMs = Date.now() - new Date(prevPos.updated_at).getTime();
          if (ageMs >= 0 && ageMs < 8_000) {
            const sameZone = (prevPos.zone_id || null) === (lastZone || null);
            const dLat = Math.abs(Number(prevPos.lat) - body.lat);
            const dLng = Math.abs(Number(prevPos.lng) - body.lng);
            // ~5m ≈ 0.000045 deg lat
            if (sameZone && dLat < 0.000045 && dLng < 0.000045) {
              skipUpsert = true;
            }
          }
        }
      }

      if (!skipUpsert) {
        await supabase.from("worker_last_positions").upsert(
          {
            worker_id: subject.worker_id,
            project_id: body.project_id,
            company_id: subject.company_id,
            zone_id: lastZone,
            lat: body.lat,
            lng: body.lng,
            accuracy_m: body.accuracy_m,
            source,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "worker_id" },
        );
      }
    }

    // Always HTTP 200 with zone judgment fields so clients (locationTracker) can
    // read zone_type / event_type even when the audit-log INSERT failed.
    // Insert failures are surfaced via event_insert_* + console.error only.
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
        event_insert_ok: eventType ? eventInsertError == null : null,
        event_insert_error: eventInsertError,
        lat: body.lat,
        lng: body.lng,
        raw_lat: rawLat,
        raw_lng: rawLng,
        calibrated: body.lat !== rawLat || body.lng !== rawLng,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
