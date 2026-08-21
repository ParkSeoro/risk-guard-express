-- Isolated Vision Fleet schema. Does not alter existing GPS/permit/announcement tables.

CREATE TABLE IF NOT EXISTS public.vision_gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  company_id uuid REFERENCES public.companies(id),
  external_id text NOT NULL UNIQUE,
  device_name text,
  device_fingerprint text,
  enroll_status text NOT NULL DEFAULT 'unpaired'
    CHECK (enroll_status IN ('unpaired','pending','enrolled','revoked')),
  access_token_hash text,
  client_id text,
  last_seen_at timestamptz,
  connection_state text,
  alarm_interlock_enabled boolean NOT NULL DEFAULT false,
  desired_state_version integer NOT NULL DEFAULT 1,
  desired_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_nvrs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id uuid NOT NULL REFERENCES public.vision_gateways(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  nvr_id text NOT NULL,
  name text NOT NULL,
  vendor text,
  host_hint text,
  online boolean,
  UNIQUE (gateway_id, nvr_id)
);

CREATE TABLE IF NOT EXISTS public.vision_cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id uuid NOT NULL REFERENCES public.vision_gateways(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  camera_id text NOT NULL,
  nvr_id text,
  name text NOT NULL,
  zone_label text,
  health_state text,
  last_frame_at timestamptz,
  UNIQUE (gateway_id, camera_id)
);

CREATE TABLE IF NOT EXISTS public.vision_gateway_health (
  gateway_id uuid PRIMARY KEY REFERENCES public.vision_gateways(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_safety_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  gateway_id uuid NOT NULL REFERENCES public.vision_gateways(id) ON DELETE CASCADE,
  camera_id text,
  event_type text NOT NULL,
  severity text NOT NULL,
  rule_outcome text,
  occurred_at timestamptz NOT NULL,
  requires_human_review boolean NOT NULL DEFAULT true,
  review_status text NOT NULL DEFAULT 'open'
    CHECK (review_status IN ('open','acked','dismissed')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_command_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  gateway_id uuid NOT NULL REFERENCES public.vision_gateways(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  status text NOT NULL,
  detail text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.vision_device_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code text NOT NULL UNIQUE,
  device_name text,
  device_fingerprint text,
  csr_pem text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired')),
  project_id uuid REFERENCES public.projects(id),
  approved_by uuid,
  gateway_id uuid REFERENCES public.vision_gateways(id),
  enrollment jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_provisioning_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  bootstrap_token_hash text NOT NULL,
  kit_blob text NOT NULL,
  created_by uuid,
  claimed_at timestamptz,
  claimed_by_fingerprint text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_stream_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  gateway_id uuid NOT NULL REFERENCES public.vision_gateways(id) ON DELETE CASCADE,
  camera_id text NOT NULL,
  action text NOT NULL DEFAULT 'live_substream',
  subject_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  max_bitrate_kbps integer NOT NULL DEFAULT 700,
  relay_url text,
  watermark text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_relay_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.vision_stream_grants(id) ON DELETE CASCADE,
  gateway_id uuid NOT NULL REFERENCES public.vision_gateways(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  status text NOT NULL DEFAULT 'announced'
    CHECK (status IN ('announced','active','ended','rejected')),
  publish_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.vision_audit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id),
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vision_gateways_project ON public.vision_gateways (project_id);
CREATE INDEX IF NOT EXISTS idx_vision_events_project ON public.vision_safety_events (project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_grants_gateway ON public.vision_stream_grants (gateway_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_vision_auth_code ON public.vision_device_authorizations (user_code);

ALTER TABLE public.vision_gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_nvrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_gateway_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_safety_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_command_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_device_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_provisioning_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_stream_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_relay_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_audit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vision_gateways_select ON public.vision_gateways;
DROP POLICY IF EXISTS vision_nvrs_select ON public.vision_nvrs;
DROP POLICY IF EXISTS vision_cameras_select ON public.vision_cameras;
DROP POLICY IF EXISTS vision_health_select ON public.vision_gateway_health;
DROP POLICY IF EXISTS vision_events_select ON public.vision_safety_events;
DROP POLICY IF EXISTS vision_events_update ON public.vision_safety_events;
DROP POLICY IF EXISTS vision_acks_select ON public.vision_command_acks;
DROP POLICY IF EXISTS vision_authz_select ON public.vision_device_authorizations;
DROP POLICY IF EXISTS vision_kits_select ON public.vision_provisioning_kits;
DROP POLICY IF EXISTS vision_grants_select ON public.vision_stream_grants;
DROP POLICY IF EXISTS vision_relay_select ON public.vision_relay_sessions;
DROP POLICY IF EXISTS vision_audit_select ON public.vision_audit_ledger;

CREATE POLICY vision_gateways_select ON public.vision_gateways FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_nvrs_select ON public.vision_nvrs FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_cameras_select ON public.vision_cameras FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_health_select ON public.vision_gateway_health FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_events_select ON public.vision_safety_events FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_events_update ON public.vision_safety_events FOR UPDATE TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id))
  WITH CHECK (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_acks_select ON public.vision_command_acks FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_authz_select ON public.vision_device_authorizations FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR project_id IS NULL
    OR public.is_project_member(auth.uid(), project_id)
  );
CREATE POLICY vision_kits_select ON public.vision_provisioning_kits FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_grants_select ON public.vision_stream_grants FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_relay_select ON public.vision_relay_sessions FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY vision_audit_select ON public.vision_audit_ledger FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR (project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id))
  );

GRANT SELECT ON public.vision_gateways, public.vision_nvrs, public.vision_cameras,
  public.vision_gateway_health, public.vision_safety_events, public.vision_command_acks,
  public.vision_device_authorizations, public.vision_provisioning_kits,
  public.vision_stream_grants, public.vision_relay_sessions, public.vision_audit_ledger
  TO authenticated;
GRANT UPDATE ON public.vision_safety_events TO authenticated;
GRANT ALL ON public.vision_gateways, public.vision_nvrs, public.vision_cameras,
  public.vision_gateway_health, public.vision_safety_events, public.vision_command_acks,
  public.vision_device_authorizations, public.vision_provisioning_kits,
  public.vision_stream_grants, public.vision_relay_sessions, public.vision_audit_ledger
  TO service_role;
