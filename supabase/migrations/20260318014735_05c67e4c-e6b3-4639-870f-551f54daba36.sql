-- Fix #2: Tighten risk_item_versions INSERT policy
DROP POLICY IF EXISTS "System can insert versions" ON public.risk_item_versions;
CREATE POLICY "System can insert versions" ON public.risk_item_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.risk_items ri
      WHERE ri.id = risk_item_versions.risk_item_id
      AND is_project_member(auth.uid(), ri.project_id)
    )
  );

-- Fix #4: Tighten audit_logs SELECT policy
DROP POLICY IF EXISTS "Members can view audit logs" ON public.audit_logs;
CREATE POLICY "Members can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    project_id IS NULL
    OR is_project_member(auth.uid(), project_id)
  );