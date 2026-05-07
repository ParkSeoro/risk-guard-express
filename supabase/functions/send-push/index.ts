// Web Push 발송 전용 edge function (VAPID)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Payload {
  user_id: string;
  title: string;
  body?: string;
  url?: string;
  related_id?: string;
  related_type?: string;
  tag?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const p: Payload = await req.json();
    if (!p.user_id || !p.title) {
      return new Response(JSON.stringify({ error: "user_id, title required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", p.user_id);
    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, reason: "no_subscriptions" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = JSON.stringify({
      title: p.title,
      body: p.body || "",
      url: p.url || "/m/alerts",
      tag: p.tag,
      related_id: p.related_id,
      related_type: p.related_type,
    });

    let sent = 0, failed = 0;
    const expiredIds: string[] = [];

    await Promise.all(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        sent++;
      } catch (e: any) {
        failed++;
        if (e?.statusCode === 404 || e?.statusCode === 410) expiredIds.push(s.id);
      }
    }));

    if (expiredIds.length) {
      await supabase.from("push_subscriptions").delete().in("id", expiredIds);
    }
    if (sent > 0) {
      await supabase.from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("user_id", p.user_id);
    }

    return new Response(JSON.stringify({ success: true, sent, failed, expired: expiredIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
