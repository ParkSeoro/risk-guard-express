-- Tighten approvals SELECT policy so project members only read approvals for their
-- own company / subtree (or rows where they are the designated approver), while
-- client managers and masters retain full project visibility.
ALTER POLICY "Project members can view approvals" ON public.approvals
  USING (
    public.is_master(auth.uid())
    OR approver_id = auth.uid()
    OR (
      public.is_project_member(auth.uid(), project_id)
      AND (
        company_id IS NULL
        OR public.can_read_company_data(auth.uid(), project_id, company_id)
      )
    )
  );
