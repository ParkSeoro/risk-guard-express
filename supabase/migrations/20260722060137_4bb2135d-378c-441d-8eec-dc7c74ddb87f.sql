DROP POLICY IF EXISTS permit_tpl_select_active_authenticated ON public.permit_form_templates;

CREATE POLICY permit_tpl_select_scoped
  ON public.permit_form_templates
  FOR SELECT
  TO authenticated
  USING (
    is_deleted = false
    AND (
      project_id IS NULL
      OR public.is_master(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = permit_form_templates.project_id
          AND pm.user_id = auth.uid()
      )
    )
  );