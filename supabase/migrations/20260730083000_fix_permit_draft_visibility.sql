-- Restrict draft/rejected work_permit visibility:
-- 작성중/임시저장: author or project admin (incl. safety_manager/master)
-- 반려: author, project admin, or user on that permit's approval line
-- Other statuses: existing project/company scoping unchanged

DROP POLICY IF EXISTS "Members can view work_permits" ON public.work_permits;
CREATE POLICY "Members can view work_permits"
  ON public.work_permits FOR SELECT
  USING (
    is_project_member(auth.uid(), project_id)
    AND (
      NOT is_contractor_user(auth.uid(), project_id)
      OR company_id = get_user_company_id(auth.uid(), project_id)
      OR created_by = auth.uid()
    )
    AND (
      -- Open / in-flight / issued statuses
      status IS NULL
      OR status NOT IN ('작성중', '임시저장', '반려')
      OR created_by = auth.uid()
      OR is_master(auth.uid())
      OR is_project_admin(auth.uid(), project_id)
      OR (
        status = '반려'
        AND EXISTS (
          SELECT 1
          FROM public.approvals a
          WHERE a.entity_type = 'work_permit'
            AND a.entity_id = work_permits.id
            AND a.approver_id = auth.uid()
        )
      )
    )
  );
