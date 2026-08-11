-- 결재선(approval_lines) 저장: 위평 작성 주체인 관리감독자·소장도 저장 가능해야 함.
-- 기존: project_admin / safety_manager 만 → 저장 시 DELETE 후 INSERT 실패로 라인이 비는 증상.

DROP POLICY IF EXISTS "Admins can insert approval lines" ON public.approval_lines;
DROP POLICY IF EXISTS "Admins can update approval lines" ON public.approval_lines;
DROP POLICY IF EXISTS "Admins can delete approval lines" ON public.approval_lines;

CREATE POLICY "Admins can insert approval lines" ON public.approval_lines
FOR INSERT TO authenticated
WITH CHECK (
  public.has_project_role(
    auth.uid(),
    project_id,
    ARRAY[
      'project_admin',
      'safety_manager',
      'site_manager',
      'site_supervisor'
    ]::public.project_role[]
  )
);

CREATE POLICY "Admins can update approval lines" ON public.approval_lines
FOR UPDATE TO authenticated
USING (
  public.has_project_role(
    auth.uid(),
    project_id,
    ARRAY[
      'project_admin',
      'safety_manager',
      'site_manager',
      'site_supervisor'
    ]::public.project_role[]
  )
)
WITH CHECK (
  public.has_project_role(
    auth.uid(),
    project_id,
    ARRAY[
      'project_admin',
      'safety_manager',
      'site_manager',
      'site_supervisor'
    ]::public.project_role[]
  )
);

CREATE POLICY "Admins can delete approval lines" ON public.approval_lines
FOR DELETE TO authenticated
USING (
  public.has_project_role(
    auth.uid(),
    project_id,
    ARRAY[
      'project_admin',
      'safety_manager',
      'site_manager',
      'site_supervisor'
    ]::public.project_role[]
  )
);
