-- CCTV company isolation.
-- 발주처 PA·SM / master: 프로젝트 전체
-- 시공사: 자사 + 하위 협력사 + 현장 공용(NULL)
-- 협력사: 자사 + 현장 공용(NULL)
-- 기존 카메라는 company_id NULL = 현장 공용 (마스터가 배정하기 전)

ALTER TABLE public.vision_cameras
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

CREATE INDEX IF NOT EXISTS vision_cameras_project_company_idx
  ON public.vision_cameras (project_id, company_id);

-- Infra (gateway/nvr/health/grant/relay) stays GC·발주처 only.
CREATE OR REPLACE FUNCTION public.is_vision_infra_viewer(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT public.is_vision_operator(_user_id, _project_id)
    OR EXISTS (
      SELECT 1
        FROM public.project_members pm
        LEFT JOIN public.companies c ON c.id = pm.company_id
       WHERE pm.user_id = _user_id
         AND pm.project_id = _project_id
         AND COALESCE(pm.role_new::text, '') IN ('supervisor', 'site_supervisor')
         AND COALESCE(c.type, '') NOT IN (
           'contractor', 'vendor', '협력사', '하청', 'subcontractor', '공급사', '납품사'
         )
    );
$$;

REVOKE ALL ON FUNCTION public.is_vision_infra_viewer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_vision_infra_viewer(uuid, uuid) TO authenticated, service_role;

-- Camera viewers include 협력사 managers with the same roles.
CREATE OR REPLACE FUNCTION public.is_vision_viewer(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT public.is_vision_operator(_user_id, _project_id)
    OR EXISTS (
      SELECT 1
        FROM public.project_members pm
       WHERE pm.user_id = _user_id
         AND pm.project_id = _project_id
         AND COALESCE(pm.role_new::text, '') IN (
           'project_admin', 'safety_manager', 'site_manager',
           'supervisor', 'site_supervisor'
         )
    );
$$;

REVOKE ALL ON FUNCTION public.is_vision_viewer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_vision_viewer(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_view_vision_camera(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT public.is_vision_viewer(_user_id, _project_id)
    AND (
      _company_id IS NULL
      OR public.can_access_company_data(_user_id, _project_id, _company_id)
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_vision_camera(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_vision_camera(uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS vision_gateways_select ON public.vision_gateways;
CREATE POLICY vision_gateways_select ON public.vision_gateways FOR SELECT TO authenticated
  USING (public.is_vision_infra_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_nvrs_select ON public.vision_nvrs;
CREATE POLICY vision_nvrs_select ON public.vision_nvrs FOR SELECT TO authenticated
  USING (public.is_vision_infra_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_health_select ON public.vision_gateway_health;
CREATE POLICY vision_health_select ON public.vision_gateway_health FOR SELECT TO authenticated
  USING (public.is_vision_infra_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_acks_select ON public.vision_command_acks;
CREATE POLICY vision_acks_select ON public.vision_command_acks FOR SELECT TO authenticated
  USING (public.is_vision_infra_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_grants_select ON public.vision_stream_grants;
CREATE POLICY vision_grants_select ON public.vision_stream_grants FOR SELECT TO authenticated
  USING (public.is_vision_infra_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_relay_select ON public.vision_relay_sessions;
CREATE POLICY vision_relay_select ON public.vision_relay_sessions FOR SELECT TO authenticated
  USING (public.is_vision_infra_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_audit_select ON public.vision_audit_ledger;
CREATE POLICY vision_audit_select ON public.vision_audit_ledger FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR (project_id IS NOT NULL AND public.is_vision_infra_viewer(auth.uid(), project_id))
  );

DROP POLICY IF EXISTS vision_cameras_select ON public.vision_cameras;
CREATE POLICY vision_cameras_select ON public.vision_cameras FOR SELECT TO authenticated
  USING (public.can_view_vision_camera(auth.uid(), project_id, company_id));

DROP POLICY IF EXISTS vision_events_select ON public.vision_safety_events;
CREATE POLICY vision_events_select ON public.vision_safety_events FOR SELECT TO authenticated
  USING (
    public.is_vision_viewer(auth.uid(), project_id)
    AND (
      camera_id IS NULL
      OR NOT EXISTS (
        SELECT 1
          FROM public.vision_cameras vc
         WHERE vc.project_id = vision_safety_events.project_id
           AND vc.gateway_id = vision_safety_events.gateway_id
           AND vc.camera_id = vision_safety_events.camera_id
           AND vc.company_id IS NOT NULL
           AND NOT public.can_access_company_data(auth.uid(), vc.project_id, vc.company_id)
      )
    )
  );
