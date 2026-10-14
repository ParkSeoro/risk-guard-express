-- 배치전 건강진단은 근로자 카드에서 현장관리자·관리감독자도 등록한다.
-- 마스터·현장소장(project_admin)·안전관리자는 기존처럼 프로젝트 전체를 쓸 수 있다.
-- 현장관리자·관리감독자는 자기 회사(하위 회사 포함) 근로자만 등록·수정·삭제한다.
-- 근로자·열람자는 쓰지 못한다.

DROP POLICY IF EXISTS hc_write ON public.health_checkups;
CREATE POLICY hc_write ON public.health_checkups
FOR ALL TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_project_role(
    auth.uid(),
    project_id,
    ARRAY['project_admin','safety_manager']::public.project_role[]
  )
  OR (
    public.has_project_role(
      auth.uid(),
      project_id,
      ARRAY['site_manager','supervisor']::public.project_role[]
    )
    AND public.can_access_company_data(auth.uid(), project_id, company_id)
  )
)
WITH CHECK (
  public.is_master(auth.uid())
  OR public.has_project_role(
    auth.uid(),
    project_id,
    ARRAY['project_admin','safety_manager']::public.project_role[]
  )
  OR (
    public.has_project_role(
      auth.uid(),
      project_id,
      ARRAY['site_manager','supervisor']::public.project_role[]
    )
    AND public.can_access_company_data(auth.uid(), project_id, company_id)
  )
);
