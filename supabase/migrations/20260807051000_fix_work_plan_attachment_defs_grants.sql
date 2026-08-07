-- 작업계획서 증빙 설정 테이블 권한 누락 수정
-- (CREATE TABLE 후 GRANT 없이 RLS만 켜져 저장/조회가 실패할 수 있음)

CREATE TABLE IF NOT EXISTS public.work_plan_attachment_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_type text NOT NULL DEFAULT '*',
  attachment_key text NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
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

ALTER TABLE public.work_plan_attachment_defs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_plan_attachment_defs TO authenticated;
GRANT ALL ON public.work_plan_attachment_defs TO service_role;

-- 정책 재적용 (idempotent)
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
        AND pm.role_new IN ('project_admin'::public.project_role, 'safety_manager'::public.project_role)
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
        AND pm.role_new IN ('project_admin'::public.project_role, 'safety_manager'::public.project_role)
    )
  )
  WITH CHECK (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.project_id = work_plan_attachment_defs.project_id
        AND pm.role_new IN ('project_admin'::public.project_role, 'safety_manager'::public.project_role)
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
        AND pm.role_new IN ('project_admin'::public.project_role, 'safety_manager'::public.project_role)
    )
  );
