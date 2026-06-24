-- 1) is_global_admin → master only
CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id)
$$;

-- 2) notifications insert: self-only
DROP POLICY IF EXISTS "Users can insert own notifications or admins" ON public.notifications;
CREATE POLICY "Users can insert own notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 3) ai_risk_cache: require project membership + self-attributed
DROP POLICY IF EXISTS "Authenticated users can insert cache" ON public.ai_risk_cache;
DROP POLICY IF EXISTS "Authenticated users can update cache" ON public.ai_risk_cache;

CREATE POLICY "Project members can insert cache"
ON public.ai_risk_cache
FOR INSERT
TO authenticated
WITH CHECK (
  (created_by IS NULL OR created_by = auth.uid())
  AND (
    public.is_master(auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.user_id = auth.uid())
  )
);

CREATE POLICY "Project members can update cache"
ON public.ai_risk_cache
FOR UPDATE
TO authenticated
USING (
  public.is_master(auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.user_id = auth.uid())
)
WITH CHECK (
  public.is_master(auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.user_id = auth.uid())
);

-- 4) tbm_participations: scope by company
DROP POLICY IF EXISTS "Admins can view tbm_participations" ON public.tbm_participations;
CREATE POLICY "Company-scoped admins can view tbm_participations"
ON public.tbm_participations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tbm_sessions s
    WHERE s.id = tbm_participations.tbm_session_id
      AND (
        public.is_master(auth.uid())
        OR (
          public.has_project_role(
            auth.uid(), s.project_id,
            ARRAY['project_admin'::public.project_role, 'safety_manager'::public.project_role]
          )
          AND (
            s.company_id IS NULL
            OR public.can_access_company_data(auth.uid(), s.project_id, s.company_id)
          )
        )
      )
  )
);

-- 5) Lock down internal SECURITY DEFINER helpers
DO $$
DECLARE
  fn text;
  internal_fns text[] := ARRAY[
    'apply_env_exceedance_to_risk(uuid)',
    'mark_required_items_overdue()',
    'generate_worker_required_items(uuid)',
    'generate_legal_duty_todos(uuid)',
    'get_worker_health_warnings(uuid)',
    'get_worker_today_content(uuid)',
    'get_wpa_missing_mandatory(uuid)',
    'save_risk_item_version()',
    'set_default_retention()',
    'sync_worker_health_status()',
    'lock_wpa_on_approval()',
    'prevent_last_master_removal()',
    'prevent_last_master_update()',
    'trg_assessment_run_approved_notify()',
    'trg_daily_health_log_complete()',
    'trg_env_measurement_exceedance()',
    'trg_health_checkup_complete_requirement()',
    'trg_health_education_complete_requirement()',
    'trg_health_education_log_sync()',
    'trg_worker_after_insert_requirements()',
    'trg_worker_auto_requirements()',
    'trg_worker_daily_log_flag()',
    'ensure_master_allowlist(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY internal_fns LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END LOOP;
END $$;