-- Empty target_company_ids used to hide a colleague's RA from contractor RLS.
-- Same-company authors stay visible. Rule is global (any project / any company).

DROP POLICY IF EXISTS "Members can view runs" ON public.assessment_runs;
CREATE POLICY "Members can view runs"
  ON public.assessment_runs FOR SELECT
  USING (
    is_project_member(auth.uid(), project_id)
    AND (
      NOT is_contractor_user(auth.uid(), project_id)
      OR created_by = auth.uid()
      OR author_user_id = auth.uid()
      OR (
        target_company_ids IS NOT NULL
        AND COALESCE(array_length(target_company_ids, 1), 0) > 0
        AND get_user_company_id(auth.uid(), project_id) = ANY(target_company_ids)
      )
      OR (
        COALESCE(array_length(target_company_ids, 1), 0) = 0
        AND get_user_company_id(auth.uid(), project_id) = ANY(
          public.assessment_run_effective_company_ids(assessment_runs)
        )
      )
    )
  );
