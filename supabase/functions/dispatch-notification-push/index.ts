// Unified push dispatcher.
// Triggered by DB trigger (pg_net) after notifications INSERT.
// Only accepts service_role Bearer.
//
// Deploy notes (한 번만):
//   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<ref>.supabase.co';
//   ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_jwt>';
// Secrets:
//   VAPID_* (web push)
//   FIREBASE_SERVICE_ACCOUNT_JSON  ← 권장 (Admin SDK JSON 전체, FCM HTTP v1)
//   FCM_SERVER_KEY                 ← 레거시 폴백 (선택)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import * as jose from "https://esm.sh/jose@5.9.6";

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

interface ServiceAccount {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
}

const ENTITY_ROUTES: Record<string, (id?: string | null, project?: string | null) => string> = {
  work_plan: (id) => (id ? `/work-plan/${id}` : "/work-plans"),
  work_permit: (id) => (id ? `/work-permits/${id}` : "/work-permits"),
  assessment_run: (id) => (id ? `/assessment-run/${id}` : "/risk-assessment"),
  safety_inspection: () => "/safety-inspections",
  incident: () => "/incidents",
  emergency_drill: () => "/emergency-drills",
  tbm: () => "/tbm-logs",
  todo: () => "/todo",
  worker: () => "/workers",
  chemical: () => "/health/chemicals",
  safety_cost: () => "/safety-cost",
  zone_event: () => "/app/worker/alerts",
};

function deepLinkFor(n: NotificationRow): string {
  const explicit = (n.link || "").trim();
  if (n.type?.startsWith("approval") || n.related_type === "approval") {
    return "/app/worker/approvals";
  }
  if (explicit) {
    if (explicit === "/m" || explicit.startsWith("/m/")) {
      return explicit === "/m" ? "/app/worker/menu" : `/app/worker${explicit.slice(2)}`;
    }
    if (explicit.startsWith("/zone-events")) return "/app/worker/alerts";
    return explicit;
  }
  if (n.related_type && ENTITY_ROUTES[n.related_type]) {
    return ENTITY_ROUTES[n.related_type](n.related_id, n.project_id);
  }
  if (n.type === "danger_zone_entry") {
    return "/app/worker/alerts";
  }
  return "/app/worker/alerts";
}

function parseServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw?.trim()) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa?.project_id || !sa?.private_key || !sa?.client_email) {
      console.warn("[dispatch] FIREBASE_SERVICE_ACCOUNT_JSON missing fields");
      return null;
    }
    return sa;
  } catch (e) {
    console.warn("[dispatch] FIREBASE_SERVICE_ACCOUNT_JSON invalid JSON", e);
    return null;
  }
}

let cachedAccess: { token: string; expMs: number } | null = null;

async function getFcmAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (cachedAccess && cachedAccess.expMs > now + 60_000) {
    return cachedAccess.token;
  }
  const pkPem = sa.private_key.replace(/\\n/g, "\n");
  const key = await jose.importPKCS8(pkPem, "RS256");
  const assertion = await new jose.SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      `oauth token failed: ${tokenRes.status} ${JSON.stringify(tokenJson).slice(0, 300)}`,
    );
  }
  const expiresIn = Number(tokenJson.expires_in) || 3600;
  cachedAccess = {
    token: tokenJson.access_token as string,
    expMs: now + expiresIn * 1000,
  };
  return cachedAccess.token;
}

function dataPayload(
  n: NotificationRow,
  body: string,
  commonData: Record<string, unknown>,
  isCriticalAlarm: boolean,
): Record<string, string> {
  return {
    title: n.title,
    body,
    critical: isCriticalAlarm ? "1" : "0",
    ...Object.fromEntries(
      Object.entries(commonData).map(([k, v]) => [k, v == null ? "" : String(v)]),
    ),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  const n: NotificationRow = payload?.record ?? payload;
  if (!n?.user_id || !n?.title) {
    return new Response(JSON.stringify({ error: "user_id, title required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

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

  const result = {
    web: { sent: 0, failed: 0 },
    native: { sent: 0, failed: 0 },
    native_mode: "none" as string,
  };

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

  // ---------- Native FCM ----------
  const isCriticalAlarm =
    n.type === "danger_zone_entry" ||
    n.severity === "high" ||
    n.severity === "critical" ||
    n.severity === "danger";

  const sa = parseServiceAccount();
  const legacyKey = Deno.env.get("FCM_SERVER_KEY");

  if (sa || legacyKey) {
    try {
      const { data: toks } = await supabase
        .from("device_push_tokens")
        .select("id, token, platform")
        .eq("user_id", n.user_id);
      const expired: string[] = [];
      const data = dataPayload(n, body, commonData, isCriticalAlarm);

      if (sa) {
        result.native_mode = "http_v1";
        const accessToken = await getFcmAccessToken(sa);
        const endpoint =
          `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

        await Promise.all(
          (toks || []).map(async (t: any) => {
            try {
              const platform = (t.platform || "").toLowerCase();
              const message: Record<string, unknown> = {
                token: t.token,
                notification: { title: n.title, body },
                data,
                android: {
                  priority: "HIGH",
                  notification: {
                    channel_id: isCriticalAlarm ? "safenex_alarms" : "safenex_default",
                    sound: isCriticalAlarm ? "siren" : "default",
                    icon: "ic_stat_safenex",
                    color: "#0D9488",
                    ...(tag ? { tag } : {}),
                    // Do not set click_action to a web path — tap routing uses data.link
                  },
                },
              };
              if (isCriticalAlarm && platform === "ios") {
                message.apns = {
                  headers: { "apns-priority": "10", "apns-push-type": "alert" },
                  payload: {
                    aps: {
                      alert: { title: n.title, body },
                      "interruption-level": "critical",
                      sound: { critical: 1, name: "siren.wav", volume: 1.0 },
                    },
                  },
                };
              }

              const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ message }),
              });
              const j = await res.json().catch(() => ({}));
              if (!res.ok) {
                result.native.failed++;
                const errCode = j?.error?.details?.[0]?.errorCode || j?.error?.status || "";
                if (
                  String(errCode).includes("UNREGISTERED") ||
                  String(j?.error?.message || "").includes("Requested entity was not found")
                ) {
                  expired.push(t.id);
                }
                console.warn("[dispatch] fcm v1 fail", res.status, JSON.stringify(j).slice(0, 400));
              } else {
                result.native.sent++;
              }
            } catch (e) {
              result.native.failed++;
              console.warn("[dispatch] fcm v1 error", e);
            }
          }),
        );
      } else if (legacyKey) {
        result.native_mode = "legacy";
        await Promise.all(
          (toks || []).map(async (t: any) => {
            try {
              const platform = (t.platform || "").toLowerCase();
              const apnsCritical =
                isCriticalAlarm && platform === "ios"
                  ? {
                      headers: { "apns-priority": "10", "apns-push-type": "alert" },
                      payload: {
                        aps: {
                          alert: { title: n.title, body },
                          "interruption-level": "critical",
                          sound: { critical: 1, name: "siren.wav", volume: 1.0 },
                        },
                      },
                    }
                  : undefined;

              const res = await fetch("https://fcm.googleapis.com/fcm/send", {
                method: "POST",
                headers: {
                  Authorization: `key=${legacyKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  to: t.token,
                  priority: "high",
                  content_available: true,
                  notification: {
                    title: n.title,
                    body,
                    tag,
                    sound: isCriticalAlarm ? "siren" : "default",
                    android_channel_id: isCriticalAlarm ? "safenex_alarms" : "safenex_default",
                    icon: "ic_stat_safenex",
                    color: "#0D9488",
                  },
                  data,
                  ...(apnsCritical ? { apns: apnsCritical } : {}),
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
              console.warn("[dispatch] fcm legacy error", e);
            }
          }),
        );
      }

      if (expired.length) {
        await supabase.from("device_push_tokens").delete().in("id", expired);
      }
    } catch (e) {
      console.warn("[dispatch] native error", e);
    }
  } else {
    console.warn(
      "[dispatch] no FIREBASE_SERVICE_ACCOUNT_JSON or FCM_SERVER_KEY — native push skipped",
    );
  }

  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
