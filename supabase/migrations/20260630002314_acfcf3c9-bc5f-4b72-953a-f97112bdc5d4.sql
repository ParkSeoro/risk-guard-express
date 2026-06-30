
CREATE OR REPLACE FUNCTION public.is_project_admin_or_safety(_project_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'master')
  OR EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = _project_id
      AND pm.user_id = _user_id
      AND pm.role_new::text IN ('project_admin','safety_manager','master')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_project_admin_or_safety(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_admin_or_safety(uuid, uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.project_library_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'etc',
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  mime_type text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_name text,
  download_count integer NOT NULL DEFAULT 0,
  is_pinned boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid,
  deleted_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_library_files TO authenticated;
GRANT ALL ON public.project_library_files TO service_role;
ALTER TABLE public.project_library_files ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_lib_files_project ON public.project_library_files(project_id) WHERE is_deleted = false;

DROP POLICY IF EXISTS "library_select_members" ON public.project_library_files;
CREATE POLICY "library_select_members" ON public.project_library_files
  FOR SELECT TO authenticated
  USING (is_deleted = false AND public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS "library_insert_admins" ON public.project_library_files;
CREATE POLICY "library_insert_admins" ON public.project_library_files
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_admin_or_safety(project_id, auth.uid()) AND uploaded_by = auth.uid());

DROP POLICY IF EXISTS "library_update_uploader_or_master" ON public.project_library_files;
CREATE POLICY "library_update_uploader_or_master" ON public.project_library_files
  FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'));

DROP POLICY IF EXISTS "library_delete_uploader_or_master" ON public.project_library_files;
CREATE POLICY "library_delete_uploader_or_master" ON public.project_library_files
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'));

DROP TRIGGER IF EXISTS trg_library_files_updated_at ON public.project_library_files;
CREATE TRIGGER trg_library_files_updated_at
  BEFORE UPDATE ON public.project_library_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.permit_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  version text NOT NULL DEFAULT 'v1',
  layout_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_form_templates TO authenticated;
GRANT ALL ON public.permit_form_templates TO service_role;
ALTER TABLE public.permit_form_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permit_tpl_select_all" ON public.permit_form_templates;
CREATE POLICY "permit_tpl_select_all" ON public.permit_form_templates
  FOR SELECT TO authenticated USING (is_deleted = false);

DROP POLICY IF EXISTS "permit_tpl_insert_master" ON public.permit_form_templates;
CREATE POLICY "permit_tpl_insert_master" ON public.permit_form_templates
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'));

DROP POLICY IF EXISTS "permit_tpl_update_master" ON public.permit_form_templates;
CREATE POLICY "permit_tpl_update_master" ON public.permit_form_templates
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'));

DROP POLICY IF EXISTS "permit_tpl_delete_master" ON public.permit_form_templates;
CREATE POLICY "permit_tpl_delete_master" ON public.permit_form_templates
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'));

DROP TRIGGER IF EXISTS trg_permit_tpl_updated_at ON public.permit_form_templates;
CREATE TRIGGER trg_permit_tpl_updated_at
  BEFORE UPDATE ON public.permit_form_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.hotwork_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_permit_id uuid NOT NULL REFERENCES public.work_permits(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  fire_watcher_name text,
  fire_watcher_contact text,
  extinguisher_count integer,
  combustibles_removed boolean DEFAULT false,
  hot_surface_cooled boolean DEFAULT false,
  gas_test_oxygen numeric,
  gas_test_lel numeric,
  gas_test_time timestamptz,
  area_isolated boolean DEFAULT false,
  hot_work_type text,
  notes text,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_deleted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hotwork_permits TO authenticated;
GRANT ALL ON public.hotwork_permits TO service_role;
ALTER TABLE public.hotwork_permits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hotwork_select_members" ON public.hotwork_permits;
CREATE POLICY "hotwork_select_members" ON public.hotwork_permits
  FOR SELECT TO authenticated
  USING (is_deleted = false AND public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS "hotwork_insert_members" ON public.hotwork_permits;
CREATE POLICY "hotwork_insert_members" ON public.hotwork_permits
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS "hotwork_update_creator_or_admin" ON public.hotwork_permits;
CREATE POLICY "hotwork_update_creator_or_admin" ON public.hotwork_permits
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_project_admin_or_safety(project_id, auth.uid()));

DROP POLICY IF EXISTS "hotwork_delete_admin" ON public.hotwork_permits;
CREATE POLICY "hotwork_delete_admin" ON public.hotwork_permits
  FOR DELETE TO authenticated
  USING (public.is_project_admin_or_safety(project_id, auth.uid()));

DROP TRIGGER IF EXISTS trg_hotwork_updated_at ON public.hotwork_permits;
CREATE TRIGGER trg_hotwork_updated_at
  BEFORE UPDATE ON public.hotwork_permits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.work_permits
  ADD COLUMN IF NOT EXISTS form_version text DEFAULT 'SF003-Rev1',
  ADD COLUMN IF NOT EXISTS form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_assessment_run_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS permit_kinds text[] DEFAULT '{}';

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS legacy_name text;

UPDATE public.companies
SET legacy_name = COALESCE(legacy_name, name),
    name = regexp_replace(
      regexp_replace(
        regexp_replace(name, 'DIG\s*에어가스\s*\(?주\)?', '에어리퀴드', 'gi'),
        '디아이지에어가스', '에어리퀴드', 'gi'
      ),
      '(^|\s|/|-)(DIG|디아이지)(\s|/|-|$)', '\1에어리퀴드\3', 'gi'
    )
WHERE name ~* 'DIG' OR name LIKE '%디아이지%';

UPDATE public.projects
SET client = regexp_replace(
      regexp_replace(client, 'DIG\s*에어가스\s*\(?주\)?', '에어리퀴드', 'gi'),
      '디아이지에어가스', '에어리퀴드', 'gi'
    )
WHERE client ~* 'DIG' OR client LIKE '%디아이지%';

UPDATE public.projects
SET contractor = regexp_replace(
      regexp_replace(contractor, 'DIG\s*에어가스\s*\(?주\)?', '에어리퀴드', 'gi'),
      '디아이지에어가스', '에어리퀴드', 'gi'
    )
WHERE contractor ~* 'DIG' OR contractor LIKE '%디아이지%';

INSERT INTO public.permit_form_templates
  (id, project_id, code, name, version, layout_json, is_default, is_active)
SELECT gen_random_uuid(), NULL, 'SF003-Rev1', '표준 안전작업허가서', 'v1',
  '{
    "header":{"title":"안전작업허가서","doc_no":"SF003","rev":"Rev.1","issuer_label":"승인업체","issuer":"에어리퀴드"},
    "sections":[
      {"id":"work_info","title":"작업 개요","fields":[
        {"key":"permit_date","label":"발행일자","type":"date","required":true},
        {"key":"work_period","label":"작업기간","type":"daterange","required":true},
        {"key":"work_location","label":"작업장소","type":"text","required":true},
        {"key":"work_content","label":"작업내용","type":"textarea","required":true},
        {"key":"contractor","label":"작업업체","type":"text","required":true},
        {"key":"worker_count","label":"작업인원","type":"number","required":true}
      ]},
      {"id":"permit_kinds","title":"작업 종류 (해당 항목 체크)","type":"checkbox_group","items":[
        {"key":"general","label":"일반작업"},{"key":"hotwork","label":"화기작업"},
        {"key":"confined","label":"밀폐공간"},{"key":"blackout","label":"정전작업"},
        {"key":"dig_excavation","label":"굴착작업"},{"key":"height","label":"고소작업"},
        {"key":"heavy","label":"중장비작업"},{"key":"radiation","label":"방사선작업"}
      ]},
      {"id":"attachments_check","title":"첨부서류 확인","type":"checkbox_group","items":[
        {"key":"risk_assessment","label":"위험성평가","auto_attach":true},
        {"key":"jsa","label":"작업안전분석(JSA)"},
        {"key":"msds","label":"MSDS"},
        {"key":"rescue_plan","label":"비상대피계획"},
        {"key":"gas_check","label":"가스농도측정 기록"}
      ]},
      {"id":"gas_test","title":"가스농도 측정 (해당시)","fields":[
        {"key":"o2","label":"O₂ (%)","type":"number"},
        {"key":"lel","label":"LEL (%)","type":"number"},
        {"key":"h2s","label":"H₂S (ppm)","type":"number"},
        {"key":"co","label":"CO (ppm)","type":"number"},
        {"key":"measured_at","label":"측정시각","type":"datetime"}
      ]},
      {"id":"safety_checklist","title":"작업 전 안전조치 (26항)","type":"checkbox_group","items":[
        {"key":"c01","label":"작업 전 안전교육(TBM) 실시"},
        {"key":"c02","label":"개인보호구 착용 확인"},
        {"key":"c03","label":"작업도구 점검 완료"},
        {"key":"c04","label":"위험구역 출입통제"},
        {"key":"c05","label":"가스/산소 농도 측정"},
        {"key":"c06","label":"환기설비 가동"},
        {"key":"c07","label":"소화기 비치"},
        {"key":"c08","label":"인화성/가연성 물질 제거"},
        {"key":"c09","label":"전원 차단 및 LOTO 시행"},
        {"key":"c10","label":"고소작업 안전대 부착설비 확인"},
        {"key":"c11","label":"발판/사다리 점검"},
        {"key":"c12","label":"중장비 후방 신호수 배치"},
        {"key":"c13","label":"지하매설물 조사"},
        {"key":"c14","label":"흙막이 지보공 확인"},
        {"key":"c15","label":"비상연락망 게시"},
        {"key":"c16","label":"감시인 배치 (밀폐공간)"},
        {"key":"c17","label":"구조용 장비 비치 (밀폐공간)"},
        {"key":"c18","label":"화기작업 감시자 배치"},
        {"key":"c19","label":"용접/용단 차폐막 설치"},
        {"key":"c20","label":"MSDS 비치 및 확인"},
        {"key":"c21","label":"폐기물 처리계획 확인"},
        {"key":"c22","label":"기상 조건 확인"},
        {"key":"c23","label":"인접작업 간섭 확인"},
        {"key":"c24","label":"비상대피로 확보"},
        {"key":"c25","label":"응급처치 인력/장비 확인"},
        {"key":"c26","label":"작업 종료 후 정리정돈 계획"}
      ]},
      {"id":"approvals","title":"결재","type":"approval_block","auto_fill_from_approvals":true,"steps":[
        {"role":"contractor_manager","label":"담당자(시공)"},
        {"role":"safety_manager","label":"담당자(안전)"},
        {"role":"site_manager","label":"책임자(소장)"},
        {"role":"cm_manager","label":"담당자(CM)"},
        {"role":"sm_manager","label":"담당자(SM)"},
        {"role":"cooperator","label":"협조부서","optional":true}
      ]},
      {"id":"completion","title":"작업 완료 확인","fields":[
        {"key":"completed_at","label":"완료시각","type":"datetime"},
        {"key":"final_inspector","label":"최종확인자","type":"text"},
        {"key":"cleanup_done","label":"정리정돈 완료","type":"checkbox"},
        {"key":"notes","label":"특이사항","type":"textarea"}
      ]}
    ]
  }'::jsonb,
  true, true
WHERE NOT EXISTS (SELECT 1 FROM public.permit_form_templates WHERE code = 'SF003-Rev1' AND project_id IS NULL);
