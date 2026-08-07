-- 작업계획서 첨부 필수/선택 프로젝트 설정
-- 마스터·프로젝트관리자가 공종별 증빙 필수 여부를 조정하고 커스텀 항목을 추가

CREATE TABLE IF NOT EXISTS public.work_plan_attachment_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- '*' = 전 공종 공통, 그 외는 work_plans.work_type
  work_type text NOT NULL DEFAULT '*',
  attachment_key text NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  -- legal | calc_evidence | site_proof
  category text NOT NULL DEFAULT 'site_proof'
    CHECK (category IN ('legal', 'calc_evidence', 'site_proof')),
  is_mandatory boolean NOT NULL DEFAULT true,
  is_enabled boolean NOT NULL DEFAULT true,
  is_custom boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, work_type, attachment_key)
);

CREATE INDEX IF NOT EXISTS idx_wpa_defs_project
  ON public.work_plan_attachment_defs(project_id, work_type);

ALTER TABLE public.work_plan_attachment_defs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wpa_defs_select" ON public.work_plan_attachment_defs;
CREATE POLICY "wpa_defs_select" ON public.work_plan_attachment_defs
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  );

DROP POLICY IF EXISTS "wpa_defs_insert" ON public.work_plan_attachment_defs;
CREATE POLICY "wpa_defs_insert" ON public.work_plan_attachment_defs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.project_id = work_plan_attachment_defs.project_id
        AND pm.role_new = 'project_admin'::public.project_role
    )
  );

DROP POLICY IF EXISTS "wpa_defs_update" ON public.work_plan_attachment_defs;
CREATE POLICY "wpa_defs_update" ON public.work_plan_attachment_defs
  FOR UPDATE TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.project_id = work_plan_attachment_defs.project_id
        AND pm.role_new = 'project_admin'::public.project_role
    )
  )
  WITH CHECK (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.project_id = work_plan_attachment_defs.project_id
        AND pm.role_new = 'project_admin'::public.project_role
    )
  );

DROP POLICY IF EXISTS "wpa_defs_delete" ON public.work_plan_attachment_defs;
CREATE POLICY "wpa_defs_delete" ON public.work_plan_attachment_defs
  FOR DELETE TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.project_id = work_plan_attachment_defs.project_id
        AND pm.role_new = 'project_admin'::public.project_role
    )
  );

CREATE TRIGGER update_work_plan_attachment_defs_updated_at
BEFORE UPDATE ON public.work_plan_attachment_defs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.work_plan_attachment_defs IS
  'Project overrides for work-plan attachment required/optional + custom types (master/project_admin).';
