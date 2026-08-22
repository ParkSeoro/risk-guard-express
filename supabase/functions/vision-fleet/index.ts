/**
 * Isolated Vision Fleet control plane.
 * Gateway + human pairing/grants. Does not touch GPS/permit tables.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-gateway-id, x-request-id",
};

const DUMMY_CERT = `-----BEGIN CERTIFICATE-----
MIIBszCCAVmgAwIBAgIUVisionFleetDevOnlywDQYJKoZIhvcNAQELBQAwADAeFw0y
NjAxMDEwMDAwMDBaFw0zNjAxMDEwMDAwMDBaMAAwXDANBgkqhkiG9w0BAQEFAANL
ADBIAkEAxDEVONLY0000000000000000000000000000000000000000000000000
QIDAQABMA0GCSqGSIb3DQEBCwUAA0EABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
-----END CERTIFICATE-----
`;

const DUMMY_CA = DUMMY_CERT;
const DUMMY_MASTER_PUB = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA//////////////////////////////////////////8=
-----END PUBLIC KEY-----
`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sha256Hex(input: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function userCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function publicOrigin(req: Request): string {
  const env = Deno.env.get("VISION_FLEET_PUBLIC_ORIGIN") || Deno.env.get("SITE_URL");
  if (env) return env.replace(/\/$/, "");
  const url = new URL(req.url);
  if (url.hostname.includes("supabase")) return "https://safenex.app";
  return `${url.protocol}//${url.host}`;
}

function fleetBase(req: Request): string {
  const u = new URL(req.url);
  const marker = "/vision-fleet";
  const idx = u.pathname.indexOf(marker);
  const prefix = idx >= 0 ? u.pathname.slice(0, idx + marker.length) : u.pathname;
  return `${u.origin}${prefix}`;
}

function service(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { persistSession: false } },
  );
}

function userClient(jwt: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

async function audit(
  sb: SupabaseClient,
  row: { project_id?: string | null; actor_id?: string | null; action: string; entity_type?: string; entity_id?: string; detail?: unknown },
) {
  await sb.from("vision_audit_ledger").insert({
    project_id: row.project_id || null,
    actor_id: row.actor_id || null,
    action: row.action,
    entity_type: row.entity_type || null,
    entity_id: row.entity_id || null,
    detail: row.detail || {},
  });
}

async function assertVisionOperator(sb: SupabaseClient, userId: string, projectId: string) {
  const { data, error } = await sb.rpc("is_vision_operator", {
    _user_id: userId,
    _project_id: projectId,
  });
  return !error && data === true;
}

function enrollmentBundle(opts: {
  gatewayId: string;
  projectId: string;
  companyId: string | null;
  tokenUrl: string;
  clientId: string;
}) {
  return {
    gateway_id: opts.gatewayId,
    tenant_id: opts.companyId || "safenex",
    site_id: opts.projectId,
    token_url: opts.tokenUrl,
    client_id: opts.clientId,
    client_certificate_pem: DUMMY_CERT,
    ca_bundle_pem: DUMMY_CA,
    master_public_key_pem: Deno.env.get("VISION_FLEET_MASTER_PUBLIC_KEY_PEM") || DUMMY_MASTER_PUB,
    access_token: undefined as string | undefined,
  };
}

async function gatewayFromAuth(req: Request, sb: SupabaseClient, gatewayId: string) {
  const token = bearer(req);
  if (!token) return { error: json({ error: "missing token" }, 401) };
  const headerId = req.headers.get("x-gateway-id");
  if (headerId && headerId !== gatewayId) return { error: json({ error: "gateway mismatch" }, 403) };
  const hash = await sha256Hex(token);
  const { data, error } = await sb
    .from("vision_gateways")
    .select("*")
    .eq("external_id", gatewayId)
    .eq("enroll_status", "enrolled")
    .maybeSingle();
  if (error || !data || data.access_token_hash !== hash) {
    return { error: json({ error: "unauthorized gateway" }, 401) };
  }
  return { gateway: data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/vision-fleet/, "").replace(/^\/functions\/v1\/vision-fleet/, "") || "/";
  const sb = service();

  try {
    // --- OAuth token (gateway) ---
    if (req.method === "POST" && path === "/v1/oauth/token") {
      const body = await req.formData().catch(async () => {
        const j = await req.json().catch(() => ({}));
        const fd = new FormData();
        Object.entries(j as Record<string, string>).forEach(([k, v]) => fd.set(k, String(v)));
        return fd;
      });
      const clientId = String(body.get("client_id") || "");
      const token = bearer(req) || String(body.get("client_secret") || "");
      if (!clientId || !token) return json({ error: "invalid_client" }, 401);
      const hash = await sha256Hex(token);
      const { data } = await sb
        .from("vision_gateways")
        .select("id, client_id, access_token_hash, enroll_status")
        .eq("client_id", clientId)
        .eq("enroll_status", "enrolled")
        .maybeSingle();
      if (!data || data.access_token_hash !== hash) return json({ error: "invalid_client" }, 401);
      return json({ access_token: token, token_type: "Bearer", expires_in: 3600 });
    }

    // --- QR start (unauthenticated, device) ---
    if (req.method === "POST" && path === "/v1/gateway-device-authorizations") {
      const body = await req.json();
      const expiresIn = 600;
      const code = userCode();
      const origin = publicOrigin(req);
      const { data, error } = await sb
        .from("vision_device_authorizations")
        .insert({
          user_code: code,
          device_name: body.device_name || null,
          device_fingerprint: body.device_fingerprint || null,
          csr_pem: body.csr_pem || null,
          status: "pending",
          expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        })
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 400);
      const verification = `${origin}/app/worker/vision-pair?code=${code}`;
      await audit(sb, { action: "vision.authz.create", entity_type: "authorization", entity_id: data.id });
      return json({
        authorization_id: data.id,
        user_code: code,
        verification_uri: verification,
        verification_uri_complete: verification,
        expires_in: expiresIn,
        interval: 5,
      });
    }

    if (req.method === "POST" && path === "/v1/gateway-device-authorizations/lookup") {
      const jwt = bearer(req);
      if (!jwt) return json({ error: "auth required" }, 401);
      const userSb = userClient(jwt);
      const { data: userData } = await userSb.auth.getUser(jwt);
      if (!userData?.user) return json({ error: "invalid session" }, 401);
      const body = await req.json().catch(() => ({}));
      const code = String((body as { user_code?: string }).user_code || "").trim();
      if (!code) return json({ error: "user_code required" }, 400);
      const { data } = await sb
        .from("vision_device_authorizations")
        .select("id, status, expires_at")
        .eq("user_code", code)
        .maybeSingle();
      if (!data) return json({ error: "not found" }, 404);
      return json({ id: data.id, status: data.status, expires_at: data.expires_at });
    }

    if (req.method === "POST" && path === "/v1/gateway-pairings/claim") {
      return json(
        {
          error: "retired",
          message: "Use QR POST /v1/gateway-device-authorizations or kit POST /v1/gateway-bootstrap/claim",
        },
        410,
      );
    }

    const poll = path.match(/^\/v1\/gateway-device-authorizations\/([^/]+)\/poll$/);
    if (req.method === "POST" && poll) {
      const id = poll[1];
      const { data } = await sb.from("vision_device_authorizations").select("*").eq("id", id).maybeSingle();
      if (!data) return json({ error: "not found" }, 404);
      if (new Date(data.expires_at).getTime() < Date.now()) {
        await sb.from("vision_device_authorizations").update({ status: "expired" }).eq("id", id);
        return json({ error: "expired" }, 410);
      }
      if (data.status === "pending") return json({ status: "approval_pending" }, 202);
      if (data.status !== "approved" || !data.enrollment) return json({ error: "rejected" }, 400);
      const enrollment = { ...(data.enrollment as Record<string, unknown>) };
      if (data.one_time_access_token) {
        enrollment.access_token = data.one_time_access_token;
        await sb.from("vision_device_authorizations").update({ one_time_access_token: null }).eq("id", id);
      }
      return json(enrollment);
    }

    const approve = path.match(/^\/v1\/gateway-device-authorizations\/([^/]+)\/approve$/);
    if (req.method === "POST" && approve) {
      const jwt = bearer(req);
      if (!jwt) return json({ error: "auth required" }, 401);
      const userSb = userClient(jwt);
      const { data: userData } = await userSb.auth.getUser(jwt);
      if (!userData?.user) return json({ error: "invalid session" }, 401);
      const body = await req.json();
      const projectId = String(body.project_id || "");
      if (!projectId) return json({ error: "project_id required" }, 400);
      const ok = await assertVisionOperator(sb, userData.user.id, projectId);
      if (!ok) return json({ error: "forbidden" }, 403);
      const id = approve[1];
      const { data: authz } = await sb.from("vision_device_authorizations").select("*").eq("id", id).maybeSingle();
      if (!authz || authz.status !== "pending") return json({ error: "not pending" }, 400);
      const gatewayExternal = crypto.randomUUID();
      const accessToken = randomToken();
      const tokenHash = await sha256Hex(accessToken);
      const { data: gw, error: ge } = await sb
        .from("vision_gateways")
        .insert({
          project_id: projectId,
          external_id: gatewayExternal,
          device_name: authz.device_name,
          device_fingerprint: authz.device_fingerprint,
          enroll_status: "enrolled",
          access_token_hash: tokenHash,
          client_id: gatewayExternal,
        })
        .select("*")
        .single();
      if (ge) return json({ error: ge.message }, 400);
      const bundle = enrollmentBundle({
        gatewayId: gatewayExternal,
        projectId,
        companyId: gw.company_id,
        tokenUrl: `${fleetBase(req)}/v1/oauth/token`,
        clientId: gatewayExternal,
      });
      await sb
        .from("vision_device_authorizations")
        .update({
          status: "approved",
          project_id: projectId,
          approved_by: userData.user.id,
          gateway_id: gw.id,
          enrollment: bundle,
          one_time_access_token: accessToken,
        })
        .eq("id", id);
      await audit(sb, {
        project_id: projectId,
        actor_id: userData.user.id,
        action: "vision.authz.approve",
        entity_type: "gateway",
        entity_id: gw.id,
      });
      return json({ ok: true, gateway_id: gatewayExternal });
    }

    if (req.method === "POST" && path === "/v1/provisioning-kits") {
      const jwt = bearer(req);
      if (!jwt) return json({ error: "auth required" }, 401);
      const userSb = userClient(jwt);
      const { data: userData } = await userSb.auth.getUser(jwt);
      if (!userData?.user) return json({ error: "invalid session" }, 401);
      const body = await req.json();
      const projectId = String(body.project_id || "");
      if (!projectId) return json({ error: "project_id required" }, 400);
      const ok = await assertVisionOperator(sb, userData.user.id, projectId);
      if (!ok) return json({ error: "forbidden" }, 403);
      const bootstrap = randomToken();
      const payload = {
        fleet_base_url: fleetBase(req),
        bootstrap_token: bootstrap,
        project_id: projectId,
      };
      const kit = `${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.sig`;
      const { data, error } = await sb
        .from("vision_provisioning_kits")
        .insert({
          project_id: projectId,
          bootstrap_token_hash: await sha256Hex(bootstrap),
          kit_blob: kit,
          created_by: userData.user.id,
          expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        })
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 400);
      await audit(sb, {
        project_id: projectId,
        actor_id: userData.user.id,
        action: "vision.kit.create",
        entity_id: data.id,
      });
      return json({ id: data.id, kit });
    }

    if (req.method === "POST" && path === "/v1/gateway-bootstrap/claim") {
      const body = await req.json();
      const kit: string = String(body.kit || "");
      const encoded = kit.split(".")[0] || "";
      const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
      let parsed: { fleet_base_url?: string; bootstrap_token?: string; project_id?: string };
      try {
        parsed = JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/")));
      } catch {
        return json({ error: "invalid kit" }, 422);
      }
      const token = String(parsed.bootstrap_token || "");
      const hash = await sha256Hex(token);
      const { data: kitRow } = await sb
        .from("vision_provisioning_kits")
        .update({
          claimed_at: new Date().toISOString(),
          claimed_by_fingerprint: body.device_fingerprint || null,
        })
        .eq("bootstrap_token_hash", hash)
        .is("claimed_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("*")
        .maybeSingle();
      if (!kitRow) return json({ error: "kit rejected" }, 422);
      const gatewayExternal = crypto.randomUUID();
      const accessToken = randomToken();
      const { data: gw, error: ge } = await sb
        .from("vision_gateways")
        .insert({
          project_id: kitRow.project_id,
          external_id: gatewayExternal,
          device_name: body.device_name || null,
          device_fingerprint: body.device_fingerprint || null,
          enroll_status: "enrolled",
          access_token_hash: await sha256Hex(accessToken),
          client_id: gatewayExternal,
        })
        .select("*")
        .single();
      if (ge) return json({ error: ge.message }, 400);
      const bundle = enrollmentBundle({
        gatewayId: gatewayExternal,
        projectId: kitRow.project_id,
        companyId: gw.company_id,
        tokenUrl: `${fleetBase(req)}/v1/oauth/token`,
        clientId: gatewayExternal,
      });
      bundle.access_token = accessToken;
      await audit(sb, {
        project_id: kitRow.project_id,
        action: "vision.kit.claim",
        entity_type: "gateway",
        entity_id: gw.id,
      });
      return json(bundle);
    }

    const gwHeart = path.match(/^\/v1\/gateways\/([^/]+)\/heartbeats$/);
    if (req.method === "POST" && gwHeart) {
      const auth = await gatewayFromAuth(req, sb, gwHeart[1]);
      if (auth.error) return auth.error;
      const body = await req.json();
      const cameras = Array.isArray(body.camera_health) ? body.camera_health : [];
      await sb.from("vision_gateway_health").upsert({
        gateway_id: auth.gateway.id,
        project_id: auth.gateway.project_id,
        payload: body,
        observed_at: body.observed_at || new Date().toISOString(),
      });
      await sb
        .from("vision_gateways")
        .update({
          last_seen_at: new Date().toISOString(),
          connection_state: body.connection_state || "online",
          updated_at: new Date().toISOString(),
        })
        .eq("id", auth.gateway.id);
      for (const cam of cameras) {
        if (!cam?.camera_id) continue;
        const cameraId = String(cam.camera_id);
        const { data: existing } = await sb
          .from("vision_cameras")
          .select("id")
          .eq("gateway_id", auth.gateway.id)
          .eq("camera_id", cameraId)
          .maybeSingle();
        if (existing) {
          await sb
            .from("vision_cameras")
            .update({
              health_state: cam.state || "unknown",
              last_frame_at: cam.last_frame_at || null,
            })
            .eq("id", existing.id);
        } else {
          await sb.from("vision_cameras").insert({
            gateway_id: auth.gateway.id,
            project_id: auth.gateway.project_id,
            camera_id: cameraId,
            name: String(cam.name || cameraId),
            health_state: cam.state || "unknown",
            last_frame_at: cam.last_frame_at || null,
          });
        }
      }
      return json({ ok: true });
    }

    const gwEvents = path.match(/^\/v1\/gateways\/([^/]+)\/events:batch$/);
    if (req.method === "POST" && gwEvents) {
      const auth = await gatewayFromAuth(req, sb, gwEvents[1]);
      if (auth.error) return auth.error;
      const body = await req.json();
      const events = Array.isArray(body.events) ? body.events : [];
      const accepted: string[] = [];
      for (const ev of events) {
        const eventId = ev.event_id || crypto.randomUUID();
        const attrs = ev.attributes && typeof ev.attributes === "object" ? ev.attributes : {};
        const forbidden = ["password", "secret", "token", "rtsp_url", "private_key"];
        if (Object.keys(attrs).some((k) => forbidden.includes(String(k).toLowerCase()))) continue;
        const { error } = await sb.from("vision_safety_events").insert({
          event_id: eventId,
          project_id: auth.gateway.project_id,
          gateway_id: auth.gateway.id,
          camera_id: ev.camera_id || null,
          event_type: ev.event_type || "ai.safety_detected",
          severity: ev.severity || "info",
          rule_outcome: ev.rule_outcome || null,
          occurred_at: ev.occurred_at || new Date().toISOString(),
          requires_human_review: ev.requires_human_review !== false,
          attributes: attrs,
        });
        if (!error) {
          accepted.push(String(eventId));
          const title = ev.rule_outcome === "ppe_missing" ? "비전: PPE 미착용 검토" : "비전 안전 이벤트";
          const message = String(ev.rule_outcome || ev.event_type || "vision");
          const link = `/app/admin/vision-fleet?event=${eventId}`;
          await sb.rpc("notify_project_roles", {
            _project_id: auth.gateway.project_id,
            _roles: ["project_admin", "safety_manager", "site_manager"],
            _title: title,
            _message: message,
            _type: "vision_safety_event",
            _link: link,
            _related_type: "vision_safety_event",
            _related_id: String(eventId),
            _severity: null,
          });
          await sb.rpc("notify_masters", {
            _title: title,
            _message: message,
            _type: "vision_safety_event",
            _link: link,
            _project_id: auth.gateway.project_id,
            _related_type: "vision_safety_event",
            _related_id: String(eventId),
            _severity: null,
          });
        } else if (String(error.message || "").includes("duplicate") || error.code === "23505") {
          accepted.push(String(eventId));
        }
      }
      return json({ data: { accepted_event_ids: accepted } });
    }

    const gwState = path.match(/^\/v1\/gateways\/([^/]+)\/desired-state$/);
    if (req.method === "GET" && gwState) {
      const auth = await gatewayFromAuth(req, sb, gwState[1]);
      if (auth.error) return auth.error;
      const current = Number(url.searchParams.get("current_version") || 0);
      const version = Number(auth.gateway.desired_state_version) || 1;
      if (current && current === version) return new Response(null, { status: 304, headers: corsHeaders });
      const now = new Date();
      const doc = {
        version,
        issued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 86400_000).toISOString(),
        policy_bundle_id: "ppe-standard-kr-v1",
        policy_digest: "sha256:pilot",
        model_bundle_id: null,
        model_digest: null,
        rollout_stage: "pilot",
        allow_activation: false,
        alarm_interlock_enabled: Boolean(auth.gateway.alarm_interlock_enabled),
        signature: "pilot",
        key_id: "pilot",
        ...(auth.gateway.desired_state || {}),
      };
      return json({ data: doc });
    }

    const gwAck = path.match(/^\/v1\/gateways\/([^/]+)\/command-acks$/);
    if (req.method === "POST" && gwAck) {
      const auth = await gatewayFromAuth(req, sb, gwAck[1]);
      if (auth.error) return auth.error;
      const body = await req.json();
      await sb.from("vision_command_acks").insert({
        project_id: auth.gateway.project_id,
        gateway_id: auth.gateway.id,
        command_id: body.command_id,
        status: body.status || "received",
        detail: body.detail || null,
        payload: body,
      });
      return json({ ok: true });
    }

    const gwGrants = path.match(/^\/v1\/gateways\/([^/]+)\/stream-grants$/);
    if (req.method === "GET" && gwGrants) {
      const auth = await gatewayFromAuth(req, sb, gwGrants[1]);
      if (auth.error) return auth.error;
      const { data } = await sb
        .from("vision_stream_grants")
        .select("*")
        .eq("gateway_id", auth.gateway.id)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(20);
      return json({ data: data || [] });
    }

    const gwRelay = path.match(/^\/v1\/gateways\/([^/]+)\/relay-sessions$/);
    if (req.method === "POST" && gwRelay) {
      const auth = await gatewayFromAuth(req, sb, gwRelay[1]);
      if (auth.error) return auth.error;
      const body = await req.json();
      const { data, error } = await sb
        .from("vision_relay_sessions")
        .insert({
          grant_id: body.grant_id,
          gateway_id: auth.gateway.id,
          project_id: auth.gateway.project_id,
          status: "announced",
          publish_url: body.publish_url || null,
        })
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    if (req.method === "POST" && path === "/v1/stream-grants") {
      const jwt = bearer(req);
      if (!jwt) return json({ error: "auth required" }, 401);
      const userSb = userClient(jwt);
      const { data: userData } = await userSb.auth.getUser(jwt);
      if (!userData?.user) return json({ error: "invalid session" }, 401);
      const body = await req.json();
      const { data: cam } = await sb
        .from("vision_cameras")
        .select("*, vision_gateways(*)")
        .eq("id", body.camera_row_id)
        .maybeSingle();
      if (!cam) return json({ error: "camera not found" }, 404);
      const projectId = cam.project_id;
      const member = await assertVisionOperator(sb, userData.user.id, projectId);
      if (!member) return json({ error: "forbidden" }, 403);
      const expires = new Date(Date.now() + 5 * 60_000).toISOString();
      const { data: grant, error } = await sb
        .from("vision_stream_grants")
        .insert({
          project_id: projectId,
          gateway_id: cam.gateway_id,
          camera_id: cam.camera_id,
          action: body.action || "live_substream",
          subject_id: userData.user.id,
          expires_at: expires,
          max_bitrate_kbps: 700,
          watermark: `${userData.user.email || userData.user.id} · ${new Date().toISOString()}`,
          relay_url: `${fleetBase(req)}/v1/relay/sessions`,
        })
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 400);
      await audit(sb, {
        project_id: projectId,
        actor_id: userData.user.id,
        action: "vision.grant.create",
        entity_type: "stream_grant",
        entity_id: grant.id,
        detail: { camera_id: cam.camera_id, action: grant.action },
      });
      return json({ data: grant });
    }

    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
