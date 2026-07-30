-- Personal approval route templates (owner_user_id set) must not be
-- visible to other project members — including masters/admins.
-- Shared (owner null, company null) and company (owner null, company set)
-- templates remain visible to project members.

DROP POLICY IF EXISTS "Project members can view templates" ON public.approval_route_templates;
CREATE POLICY "Project members can view templates"
  ON public.approval_route_templates
  FOR SELECT
  TO authenticated
  USING (
    is_project_member(auth.uid(), project_id)
    AND (
      owner_user_id IS NULL
      OR owner_user_id = auth.uid()
    )
  );

-- Admins may manage shared/company templates only — not others' personal lines
DROP POLICY IF EXISTS "Admins can update templates" ON public.approval_route_templates;
CREATE POLICY "Admins can update templates"
  ON public.approval_route_templates
  FOR UPDATE
  TO authenticated
  USING (
    is_project_admin(auth.uid(), project_id)
    AND (owner_user_id IS NULL OR owner_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can delete templates" ON public.approval_route_templates;
CREATE POLICY "Admins can delete templates"
  ON public.approval_route_templates
  FOR DELETE
  TO authenticated
  USING (
    is_project_admin(auth.uid(), project_id)
    AND (owner_user_id IS NULL OR owner_user_id = auth.uid())
  );

-- Keep owner self-manage policy (insert/update/delete own personal)
DROP POLICY IF EXISTS "Owners manage own approval route templates" ON public.approval_route_templates;
CREATE POLICY "Owners manage own approval route templates"
  ON public.approval_route_templates
  FOR ALL
  TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
