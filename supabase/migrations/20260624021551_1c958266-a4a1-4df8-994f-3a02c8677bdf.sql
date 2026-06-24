
-- 1) worker_zone_events: drop open INSERT policy. Edge function uses service_role and bypasses RLS.
DROP POLICY IF EXISTS "anyone insert events" ON public.worker_zone_events;

-- 2) tbm_participations: restrict DELETE to project admins / safety managers
DROP POLICY IF EXISTS "Members can delete tbm_participations" ON public.tbm_participations;
CREATE POLICY "Admins can delete tbm_participations"
ON public.tbm_participations
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tbm_sessions s
    WHERE s.id = tbm_participations.tbm_session_id
      AND (
        public.is_master(auth.uid())
        OR (
          public.has_project_role(auth.uid(), s.project_id, ARRAY['project_admin'::public.project_role,'safety_manager'::public.project_role])
          AND (s.company_id IS NULL OR public.can_access_company_data(auth.uid(), s.project_id, s.company_id))
        )
      )
  )
);

-- 3) ai_generation_logs: scope INSERT to project members of referenced job
DROP POLICY IF EXISTS "ai_logs insert any auth" ON public.ai_generation_logs;
CREATE POLICY "ai_logs insert project members"
ON public.ai_generation_logs
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_master(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.ai_generation_jobs j
    WHERE j.id = ai_generation_logs.job_id
      AND (j.created_by = auth.uid() OR public.is_project_member(auth.uid(), j.project_id))
  )
);

-- 4) Lock down SECURITY DEFINER function EXECUTE privileges.
-- Revoke from PUBLIC, then grant only where intended.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- Helpers / RPCs callable by signed-in users (used by RLS policies or app RPC calls)
GRANT EXECUTE ON FUNCTION public.is_master(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_global_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_project_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_role(uuid, uuid, public.project_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_role_new(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_company_id(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_position(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_company_data(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_safety_cost(uuid, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_company_data(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_project_with(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_joinable_projects() TO authenticated;
GRANT EXECUTE ON FUNCTION public.qa_impersonate_check(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_entity_for_approval(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_worker_health_warnings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wpa_missing_mandatory(uuid) TO authenticated;

-- Public QR / worker-portal RPCs (anon allowed by design — token-gated inside the function)
GRANT EXECUTE ON FUNCTION public.confirm_worker_education(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_qr_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hazard_survey_public(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tbm_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_worker_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_worker_today_content(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_daily_qr(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_invite_code(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_worker(uuid, text, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_worker_otp(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_worker_otp(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_hazard_survey_response(text, text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_tbm_participation(text, text, text, text, boolean, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_entry(text, uuid, text, boolean, boolean, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_exit(text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_daily_scan(text, text, text, boolean, boolean, boolean, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_daily_scan(text, text, text, boolean, boolean, boolean, boolean, boolean) TO anon, authenticated;
