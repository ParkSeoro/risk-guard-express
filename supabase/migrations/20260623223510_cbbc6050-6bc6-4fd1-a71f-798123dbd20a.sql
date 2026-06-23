
-- 1. ai_generated_items_buffer: tighten INSERT policy
DROP POLICY IF EXISTS "ai_buffer insert any auth" ON public.ai_generated_items_buffer;
CREATE POLICY "ai_buffer insert project member" ON public.ai_generated_items_buffer
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_generation_jobs j
      WHERE j.id = job_id AND public.is_project_member(auth.uid(), j.project_id)
    )
  );

-- 2. hazard_survey_responses: tighten anon insert to require active survey token
DROP POLICY IF EXISTS "hsr_insert_anon" ON public.hazard_survey_responses;
DROP POLICY IF EXISTS "hsr_insert_auth" ON public.hazard_survey_responses;
CREATE POLICY "hsr_insert_via_active_survey" ON public.hazard_survey_responses
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hazard_surveys s
      WHERE s.id = survey_id
        AND s.project_id = hazard_survey_responses.project_id
        AND COALESCE(s.is_active, true) = true
        AND COALESCE(s.is_deleted, false) = false
    )
  );

-- 3. worker_phone_otps: explicit deny-all policies (PostgREST-blocked even with RLS)
ALTER TABLE public.worker_phone_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_phone_otps FROM anon, authenticated;
DROP POLICY IF EXISTS "wpo_no_select" ON public.worker_phone_otps;
DROP POLICY IF EXISTS "wpo_no_insert" ON public.worker_phone_otps;
DROP POLICY IF EXISTS "wpo_no_update" ON public.worker_phone_otps;
DROP POLICY IF EXISTS "wpo_no_delete" ON public.worker_phone_otps;
CREATE POLICY "wpo_no_select" ON public.worker_phone_otps FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "wpo_no_insert" ON public.worker_phone_otps FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "wpo_no_update" ON public.worker_phone_otps FOR UPDATE TO anon, authenticated USING (false);
CREATE POLICY "wpo_no_delete" ON public.worker_phone_otps FOR DELETE TO anon, authenticated USING (false);
GRANT ALL ON public.worker_phone_otps TO service_role;

-- 4. Storage public bucket listing: restrict SELECT (listing) to project members; public URLs still work
DROP POLICY IF EXISTS "Public can read attachments" ON storage.objects;
CREATE POLICY "Project members can list attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments' AND (
      public.is_master(auth.uid())
      OR (storage.foldername(name))[1] = (auth.uid())::text
      OR public.is_project_member(auth.uid(), NULLIF((storage.foldername(name))[1], '')::uuid)
    )
  );

-- 5. Realtime: lock down realtime.messages so channel subscribe requires explicit policy
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
  EXCEPTION WHEN insufficient_privilege OR undefined_table THEN NULL;
  END;
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "realtime_authenticated_only" ON realtime.messages';
    EXECUTE 'CREATE POLICY "realtime_authenticated_only" ON realtime.messages FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)';
  EXCEPTION WHEN insufficient_privilege OR undefined_table THEN NULL;
  END;
END $$;

-- 6. SECURITY DEFINER hardening: revoke EXECUTE from anon/authenticated on trigger functions
--    (triggers are called by Postgres internally; no client should invoke directly)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.prorettype = (SELECT oid FROM pg_type WHERE typname='trigger')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- 7. Revoke anon EXECUTE on internal RLS helpers + admin functions
--    (these are called by authenticated user policies; anon never needs them)
DO $$
DECLARE r record;
  internal_fns text[] := ARRAY[
    'is_master','is_admin','is_global_admin','is_project_admin','is_project_member',
    'is_company_project_member','has_project_role','get_project_role_new',
    'get_user_company_id','get_user_position','can_access_company_data',
    'can_write_company_data','can_access_safety_cost','shares_project_with',
    'apply_env_exceedance_to_risk','generate_legal_duty_todos',
    'generate_worker_required_items','get_my_pending_entity_approvals',
    'get_worker_health_warnings','get_worker_today_content','get_wpa_missing_mandatory',
    'mark_required_items_overdue','qa_impersonate_check','should_push_notify',
    'submit_entity_for_approval','act_on_entity_approval','list_joinable_projects'
  ];
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.proname = ANY(internal_fns)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;
