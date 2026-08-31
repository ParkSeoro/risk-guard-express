-- Work-stop handlers: safety_manager / site_manager (incl. 발주처 SM) must be able
-- to process rows they are notified about. Masters can read without membership.

DROP POLICY IF EXISTS wsr_select ON public.work_stop_requests;
CREATE POLICY wsr_select ON public.work_stop_requests
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = work_stop_requests.project_id
        AND pm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wsr_update ON public.work_stop_requests;
CREATE POLICY wsr_update ON public.work_stop_requests
  FOR UPDATE TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = work_stop_requests.project_id
        AND pm.user_id = auth.uid()
        AND COALESCE(pm.role_new::text, '') IN ('project_admin', 'safety_manager', 'site_manager')
    )
  )
  WITH CHECK (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = work_stop_requests.project_id
        AND pm.user_id = auth.uid()
        AND COALESCE(pm.role_new::text, '') IN ('project_admin', 'safety_manager', 'site_manager')
    )
  );
