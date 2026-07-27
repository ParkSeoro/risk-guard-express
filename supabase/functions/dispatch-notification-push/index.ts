// Unified push dispatcher.
// Triggered by DB trigger (pg_net) after notifications INSERT.
// Only accepts service_role Bearer.
//
// Deploy notes (한 번만):
//   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<ref>.supabase.co';
//   ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_jwt>';
//   Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, (선택) FCM_SERVER_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRow {
  id?: string;
  user_id: string;
  title: string;
  body?: string | null;
  message?: string | null;
  link?: string | null;
  type?: string | null;
  related_id?: string | null;
  related_type?: string | null;
  project_id?: string | null;
  severity?: string | null;
}

const ENTITY_ROUTES: Record<string, (id?: string | null, project?: string | null) => string> = {
  work_plan: (id) => (id ? `/work-plan/${id}` : '/work-plans'),
  work_permit: (id) => (id ? `/work-permits/${id}` : '/work-permits'),
  assessment_run: (id) => (id ? `/assessment-run/${id}` : '/risk-assessment'),
  safety_inspection: () => '/safety-inspections',
  incident: () => '/incidents',
  emergency_drill: () => '/emergency-drills',
  tbm: () => '/tbm-logs',
  todo: () => '/todo',
  worker: () => '/workers',
  chemical: () => '/health/chemicals',
  safety_cost: () => '/safety-cost',
  zone_event: (_, p) => (p ? `/zone-events?project=${p}` : '/zone-events'),
};

function deepLinkFor(n: NotificationRow): string {
  const explicit = (n.link || '').trim();
  if (explicit) return explicit;
  if (n.related_type && ENTITY_ROUTES[n.related_type]) {
    return ENTITY_ROUTES[n.related_type](n.related_id, n.project_id);
  }
  if (n.type?.startsWith('approval')) return '/m/approvals';
  if (n.type === 'danger_zone_entry') {
    return n.project_id ? `/zone-events?project=${n.project_id}` : '/zone-events';
  }
  return '/m/alerts';
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Accept either: (a) service_role Bearer (internal callers) or
  // (b) X-Push-Trigger-Secret header matching PUSH_TRIGGER_SECRET (DB trigger via pg_net).
  const authHeader = req.headers.get("Authorization") || "";
  const triggerSecretHeader = req.headers.get("X-Push-Trigger-Secret") || "";
  const triggerSecret = Deno.env.get("PUSH_TRIGGER_SECRET") || "";
  const bearerOk = authHeader.startsWith("Bearer ") && authHeader.slice(7) === serviceRoleKey;
  const secretOk = !!triggerSecret && triggerSecretHeader === triggerSecret;
  if (!bearerOk && !secretOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Accept both webhook style { record: {...} } and flat { user_id, title, ... }
  const n: NotificationRow = payload?.record ?? payload;
  if (!n?.user_id || !n?.title) {
    return new Response(JSON.stringify({ error: "user_id, title required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Preference gate
  try {
    const { data: allowed } = await supabase.rpc("should_push_notify", {
      _user_id: n.user_id,
      _type: n.type || "general",
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ ok: true, skipped: "prefs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (_e) {
    // preference table missing shouldn't block delivery
  }

  const body = (n.body || n.message || "").toString();
  const url = deepLinkFor(n);
  const tag =
    n.related_type && n.related_id ? `${n.related_type}-${n.related_id}` : n.id || undefined;

  const commonData = {
    url,
    link: url,
    type: n.type || null,
    related_type: n.related_type || null,
    related_id: n.related_id || null,
    project_id: n.project_id || null,
    notification_id: n.id || null,
    severity: n.severity || null,
  };

  const result = { web: { sent: 0, failed: 0 }, native: { sent: 0, failed: 0 } };

  // ---------- Web Push (VAPID) ----------
  const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
  const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    try {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", n.user_id);
      const expired: string[] = [];
      await Promise.all(
        (subs || []).map(async (s: any) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ title: n.title, body, url, tag, ...commonData }),
            );
            result.web.sent++;
          } catch (err: any) {
            result.web.failed++;
            if (err?.statusCode === 404 || err?.statusCode === 410) expired.push(s.id);
          }
        }),
      );
      if (expired.length) {
        await supabase.from("push_subscriptions").delete().in("id", expired);
      }
    } catch (e) {
      console.warn("[dispatch] web push error", e);
    }
  }

  // ---------- Native (FCM legacy HTTP) ----------
  const FCM_KEY = Deno.env.get("FCM_SERVER_KEY");
  if (FCM_KEY) {
    try {
      const { data: toks } = await supabase
        .from("device_push_tokens")
        .select("id, token, platform")
        .eq("user_id", n.user_id);
      const expired: string[] = [];
      await Promise.all(
        (toks || []).map(async (t: any) => {
          try {
            const res = await fetch("https://fcm.googleapis.com/fcm/send", {
              method: "POST",
              headers: {
                Authorization: `key=${FCM_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                to: t.token,
                priority: "high",
                notification: {
                  title: n.title,
                  body,
                  tag,
                  click_action: url,
                },
                data: {
                  title: n.title,
                  body,
                  ...Object.fromEntries(
                    Object.entries(commonData).map(([k, v]) => [k, v == null ? "" : String(v)]),
                  ),
                },
              }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || j.failure > 0) {
              result.native.failed++;
              const err = j?.results?.[0]?.error;
              if (err === "NotRegistered" || err === "InvalidRegistration") expired.push(t.id);
            } else {
              result.native.sent++;
            }
          } catch (e) {
            result.native.failed++;
            console.warn("[dispatch] fcm error", e);
          }
        }),
      );
      if (expired.length) {
        await supabase.from("device_push_tokens").delete().in("id", expired);
      }
    } catch (e) {
      console.warn("[dispatch] native error", e);
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
