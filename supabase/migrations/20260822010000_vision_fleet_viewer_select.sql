-- Supervisors may read the vision board. Mutating stays on is_vision_operator.

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
        LEFT JOIN public.companies c ON c.id = pm.company_id
       WHERE pm.user_id = _user_id
         AND pm.project_id = _project_id
         AND COALESCE(pm.role_new::text, '') IN ('supervisor', 'site_supervisor')
         AND COALESCE(c.type, '') NOT IN (
           'contractor', 'vendor', '협력사', '하청', 'subcontractor', '공급사', '납품사'
         )
    );
$$;

REVOKE ALL ON FUNCTION public.is_vision_viewer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_vision_viewer(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS vision_gateways_select ON public.vision_gateways;
CREATE POLICY vision_gateways_select ON public.vision_gateways FOR SELECT TO authenticated
  USING (public.is_vision_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_nvrs_select ON public.vision_nvrs;
CREATE POLICY vision_nvrs_select ON public.vision_nvrs FOR SELECT TO authenticated
  USING (public.is_vision_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_cameras_select ON public.vision_cameras;
CREATE POLICY vision_cameras_select ON public.vision_cameras FOR SELECT TO authenticated
  USING (public.is_vision_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_health_select ON public.vision_gateway_health;
CREATE POLICY vision_health_select ON public.vision_gateway_health FOR SELECT TO authenticated
  USING (public.is_vision_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_events_select ON public.vision_safety_events;
CREATE POLICY vision_events_select ON public.vision_safety_events FOR SELECT TO authenticated
  USING (public.is_vision_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_acks_select ON public.vision_command_acks;
CREATE POLICY vision_acks_select ON public.vision_command_acks FOR SELECT TO authenticated
  USING (public.is_vision_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_grants_select ON public.vision_stream_grants;
CREATE POLICY vision_grants_select ON public.vision_stream_grants FOR SELECT TO authenticated
  USING (public.is_vision_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_relay_select ON public.vision_relay_sessions;
CREATE POLICY vision_relay_select ON public.vision_relay_sessions FOR SELECT TO authenticated
  USING (public.is_vision_viewer(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_audit_select ON public.vision_audit_ledger;
CREATE POLICY vision_audit_select ON public.vision_audit_ledger FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR (project_id IS NOT NULL AND public.is_vision_viewer(auth.uid(), project_id))
  );
