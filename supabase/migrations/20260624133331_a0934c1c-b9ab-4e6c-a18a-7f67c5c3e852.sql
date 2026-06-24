
-- 1. Scorecard view uses caller's permissions
ALTER VIEW public.v_contractor_safety_scorecard SET (security_invoker = on);

-- 2. ai_risk_cache: only project members / master can read
DROP POLICY IF EXISTS "Authenticated users can view cache" ON public.ai_risk_cache;
CREATE POLICY "Project members can view cache"
  ON public.ai_risk_cache
  FOR SELECT
  TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.user_id = auth.uid())
  );

-- 3. worker_entry_logs: deny direct client inserts (writes go through SECURITY DEFINER RPCs only)
DROP POLICY IF EXISTS wel_no_client_insert ON public.worker_entry_logs;
CREATE POLICY wel_no_client_insert
  ON public.worker_entry_logs
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

-- 4. work_stop_requests insert: require project membership
DROP POLICY IF EXISTS wsr_insert ON public.work_stop_requests;
CREATE POLICY wsr_insert
  ON public.work_stop_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  );

-- 5. Realtime: drop overly broad SELECT policy (app does not use Broadcast/Presence)
DROP POLICY IF EXISTS realtime_authenticated_only ON realtime.messages;

-- 6. SECURITY DEFINER functions: revoke EXECUTE blanket, then re-grant only intended RPCs
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

DO $$
DECLARE
  fn record;
  anon_rpcs text[] := ARRAY[
    'register_worker','request_worker_otp','verify_worker_otp',
    'get_worker_by_token','get_tbm_by_token','get_worker_today_content',
    'confirm_worker_education','worker_entry','worker_exit','worker_daily_scan',
    'submit_tbm_participation','issue_daily_qr','get_daily_qr_status',
    'get_hazard_survey_public','submit_hazard_survey_response'
  ];
  auth_rpcs text[] := ARRAY[
    'acknowledge_assessment_notice','act_on_entity_approval','check_data_integrity',
    'derive_permit_from_work_plan','derive_tbm_from_work_plan',
    'generate_legal_duty_todos','get_my_pending_entity_approvals',
    'get_worker_health_warnings','ensure_master_allowlist',
    'is_global_admin','is_project_member','is_admin','is_master',
    'has_project_role','is_project_admin','is_company_project_member',
    'can_write_company_data','can_access_company_data','can_access_safety_cost',
    'shares_project_with','get_user_company_id','get_user_position','get_project_role_new',
    'list_joinable_projects','mark_required_items_overdue',
    'process_invite_code','qa_impersonate_check',
    'submit_entity_for_approval','validate_safety_cost_report',
    'delegate_approval','should_push_notify','get_wpa_missing_mandatory',
    'apply_env_exceedance_to_risk','anonymize_old_location_data',
    'generate_worker_required_items','sync_worker_health_status'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    IF fn.proname = ANY(anon_rpcs) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', fn.sig);
    ELSIF fn.proname = ANY(auth_rpcs) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
    END IF;
  END LOOP;
END $$;
