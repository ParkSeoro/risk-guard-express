/**
 * dispatch-notification-push
 *
 * Invoked when a row is inserted into `public.notifications`
 * (via pg_net trigger or Supabase Database Webhook).
 *
 * Delivery channels:
 *  1) Web Push → push_subscriptions (VAPID)
 *  2) Native Capacitor → device_push_tokens via FCM legacy HTTP
 *     (set FCM_SERVER_KEY secret; optional — skipped if unset)
 *
 * Auth: service_role Bearer only (internal webhook / pg_net).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type NotificationRecord = {
  id?: string;
  user_id: string;
  title: string;
  message?: string | null;
  body?: string | null;
  link?: string | null;
  type?: string | null;
  related_id?: string | null;
  related_type?: string | null;
  project_id?: string | null;
  severity?: string | null;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: NotificationRecord;
  // direct invoke fallback
  user_id?: string;
  title?: string;
  body?: string;
  message?: string;
  url?: string;
  link?: string;
  related_id?: string;
  related_type?: string;
  notification_type?: string;
  tag?: string;
};

function resolveDeepLink(n: NotificationRecord): string {
  if (n.link) return n.link;
  const t = n.related_type || "";
  const id = n.related_id || "";
  switch (t) {
    case "zone_event":
      return n.project_id ? `/zone-events?project=${n.project_id}` : "/zone-events";
    case "assessment_run":
      return id ? `/assessment-run/${id}` : "/risk-assessment";
    case "work_plan":
      return id ? `/work-plan/${id}` : "/work-plans";
    case "work_permit":
      return id ? `/work-permits/${id}` : "/work-permits";
    case "approval":
      return "/m/approvals";
    case "incident":
    case "incident_report":
      return "/incidents";
    case "todo":
      return "/todo";
    case "work_stop":
      return "/work-stop";
    case "safety_cost":
    case "safety_cost_report":
      return "/safety-cost";
    default:
      if ((n.type || "").startsWith("approval")) return "/m/approvals";
      if (n.type === "danger_zone_entry") return "/zone-events";
      return "/m/alerts";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token || token !== serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = (await req.json()) as WebhookPayload;
    const record: NotificationRecord | null = raw.record
      ? raw.record
      : raw.user_id && raw.title
      ? {
          user_id: raw.user_id,
          title: raw.title,
          message: raw.message ?? raw.body ?? "",
          body: raw.body ?? raw.message ?? "",
          link: raw.link ?? raw.url ?? null,
          type: raw.notification_type ?? raw.type ?? "general",
          related_id: raw.related_id ?? null,
          related_type: raw.related_type ?? null,
        }
      : null;

    if (!record?.user_id || !record?.title) {
      return new Response(JSON.stringify({ error: "record.user_id and record.title required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Preference gate
    const nType = record.type || "general";
    const { data: allow } = await supabase.rpc("should_push_notify", {
      _user_id: record.user_id,
      _type: nType,
    });
    if (allow === false) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "prefs" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bodyText = record.body || record.message || "";
    const url = resolveDeepLink(record);
    const tag = record.id || `${nType}-${record.related_id || "x"}`;

    let webSent = 0;
    let webFailed = 0;
    let nativeSent = 0;
    let nativeFailed = 0;

    // ---- Web Push (VAPID) ----
    const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

    if (VAPID_PUBLIC && VAPID_PRIVATE) {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", record.user_id);

      const payload = JSON.stringify({
        title: record.title,
        body: bodyText,
        url,
        tag,
        related_id: record.related_id,
        related_type: record.related_type,
        type: nType,
        notification_id: record.id,
      });

      const expiredIds: string[] = [];
      await Promise.all(
        ((subs as any[]) || []).map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload
            );
            webSent++;
          } catch (e: any) {
            webFailed++;
            if (e?.statusCode === 404 || e?.statusCode === 410) expiredIds.push(s.id);
          }
        })
      );
      if (expiredIds.length) {
        await supabase.from("push_subscriptions").delete().in("id", expiredIds);
      }
      if (webSent > 0) {
        await supabase
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("user_id", record.user_id);
      }
    }

    // ---- Native FCM (Capacitor tokens) ----
    const FCM_SERVER_KEY = Deno.env.get("FCM_SERVER_KEY");
    if (FCM_SERVER_KEY) {
      const { data: tokens } = await supabase
        .from("device_push_tokens")
        .select("id, token, platform")
        .eq("user_id", record.user_id);

      const staleIds: string[] = [];
      await Promise.all(
        ((tokens as any[]) || []).map(async (t) => {
          try {
            const res = await fetch("https://fcm.googleapis.com/fcm/send", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `key=${FCM_SERVER_KEY}`,
              },
              body: JSON.stringify({
                to: t.token,
                priority: "high",
                notification: {
                  title: record.title,
                  body: bodyText,
                  sound: "default",
                  click_action: "FCM_PLUGIN_ACTIVITY",
                },
                data: {
                  url,
                  link: url,
                  related_id: record.related_id || "",
                  related_type: record.related_type || "",
                  type: nType,
                  notification_id: record.id || "",
                  title: record.title,
                  body: bodyText,
                },
              }),
            });
            const json = await res.json().catch(() => ({} as any));
            if (!res.ok || json.failure === 1) {
              nativeFailed++;
              if (
                json?.results?.[0]?.error === "NotRegistered" ||
                json?.results?.[0]?.error === "InvalidRegistration"
              ) {
                staleIds.push(t.id);
              }
            } else {
              nativeSent++;
            }
          } catch {
            nativeFailed++;
          }
        })
      );
      if (staleIds.length) {
        await supabase.from("device_push_tokens").delete().in("id", staleIds);
      }
      if (nativeSent > 0) {
        await supabase
          .from("device_push_tokens")
          .update({ last_used_at: new Date().toISOString() })
          .eq("user_id", record.user_id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        web: { sent: webSent, failed: webFailed },
        native: { sent: nativeSent, failed: nativeFailed },
        url,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("dispatch-notification-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
