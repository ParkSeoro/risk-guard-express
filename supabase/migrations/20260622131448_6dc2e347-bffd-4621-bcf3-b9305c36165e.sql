
-- 1) workers 컬럼 확장
ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS job_type text,
  ADD COLUMN IF NOT EXISTS hire_date date,
  ADD COLUMN IF NOT EXISTS assigned_processes text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS assigned_chemicals uuid[] DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS requires_daily_health_log boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS health_grade text,
  ADD COLUMN IF NOT EXISTS outdoor_worker boolean NOT NULL DEFAULT false;

-- 2) 법정 교육 매핑 테이블
CREATE TABLE IF NOT EXISTS public.worker_legal_education_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  education_type text NOT NULL,
  interval_months integer NOT NULL DEFAULT 12,
  first_due_days integer NOT NULL DEFAULT 0,
  required_hours numeric,
  legal_basis text,
  is_system_default boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_legal_education_mapping TO authenticated;
GRANT ALL ON public.worker_legal_education_mapping TO service_role;
ALTER TABLE public.worker_legal_education_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wlem_select" ON public.worker_legal_education_mapping
  FOR SELECT TO authenticated
  USING (
    is_system_default = true
    OR (project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id))
  );
CREATE POLICY "wlem_insert" ON public.worker_legal_education_mapping
  FOR INSERT TO authenticated
  WITH CHECK (
    project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id)
  );
CREATE POLICY "wlem_update" ON public.worker_legal_education_mapping
  FOR UPDATE TO authenticated
  USING (project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id))
  WITH CHECK (project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wlem_delete" ON public.worker_legal_education_mapping
  FOR DELETE TO authenticated
  USING (project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id));

CREATE TRIGGER trg_wlem_updated_at BEFORE UPDATE ON public.worker_legal_education_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) 일일 건강일지 테이블
CREATE TABLE IF NOT EXISTS public.worker_daily_health_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  body_temp numeric(4,1),
  bp_systolic integer,
  bp_diastolic integer,
  sleep_hours numeric(3,1),
  symptoms jsonb NOT NULL DEFAULT '[]'::jsonb,
  fit_to_work boolean NOT NULL DEFAULT true,
  signature_data text,
  reason text NOT NULL DEFAULT 'age65',
  note text,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (worker_id, log_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_daily_health_logs TO authenticated;
GRANT ALL ON public.worker_daily_health_logs TO service_role;
ALTER TABLE public.worker_daily_health_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wdhl_select" ON public.worker_daily_health_logs
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wdhl_insert" ON public.worker_daily_health_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wdhl_update" ON public.worker_daily_health_logs
  FOR UPDATE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id))
  WITH CHECK (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wdhl_delete" ON public.worker_daily_health_logs
  FOR DELETE TO authenticated
  USING (public.is_project_admin(auth.uid(), project_id));

CREATE TRIGGER trg_wdhl_updated_at BEFORE UPDATE ON public.worker_daily_health_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_wdhl_worker_date ON public.worker_daily_health_logs(worker_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_wdhl_project_date ON public.worker_daily_health_logs(project_id, log_date DESC);

-- 4) 자동 의무사항 큐
CREATE TABLE IF NOT EXISTS public.worker_required_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  item_type text NOT NULL,       -- education | checkup | daily_log
  subtype text NOT NULL,         -- new_hire | regular | special | manager | general_health | special_health | age65 | health_d
  due_date date,
  status text NOT NULL DEFAULT 'pending', -- pending | done | overdue | skipped
  source text NOT NULL DEFAULT 'auto',
  legal_basis text,
  completed_at timestamptz,
  completed_ref_id uuid,
  notes text,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_required_items TO authenticated;
GRANT ALL ON public.worker_required_items TO service_role;
ALTER TABLE public.worker_required_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wri_select" ON public.worker_required_items
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wri_insert" ON public.worker_required_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wri_update" ON public.worker_required_items
  FOR UPDATE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id))
  WITH CHECK (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wri_delete" ON public.worker_required_items
  FOR DELETE TO authenticated
  USING (public.is_project_admin(auth.uid(), project_id));

CREATE TRIGGER trg_wri_updated_at BEFORE UPDATE ON public.worker_required_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_wri_worker ON public.worker_required_items(worker_id, item_type, status);
CREATE INDEX IF NOT EXISTS idx_wri_due ON public.worker_required_items(project_id, status, due_date);

-- 5) 시스템 기본 매핑 시드 (산안법 기준)
INSERT INTO public.worker_legal_education_mapping
  (project_id, job_type, education_type, interval_months, first_due_days, required_hours, legal_basis, is_system_default)
VALUES
  (NULL, 'general',        'new_hire',        0,  1,  8,   '산업안전보건법 시행규칙 제26조 [별표4]', true),
  (NULL, 'general',        'regular',         3,  90, 6,   '산업안전보건법 시행규칙 제26조 [별표4]', true),
  (NULL, 'office',         'regular',         3,  90, 3,   '산업안전보건법 시행규칙 제26조 [별표4]', true),
  (NULL, 'manager',        'manager',         12, 30, 16,  '산업안전보건법 시행규칙 제26조 [별표4]', true),
  (NULL, 'hazardous',      'special',         24, 1,  16,  '산업안전보건법 시행규칙 제26조 [별표5]', true),
  (NULL, 'general',        'general_health',  12, 30, NULL,'산업안전보건법 제129조 (일반건강진단)',   true),
  (NULL, 'office',         'general_health',  24, 30, NULL,'산업안전보건법 제129조 (사무직)',         true),
  (NULL, 'hazardous',      'special_health',  12, 30, NULL,'산업안전보건법 제130조 (특수건강진단)',   true),
  (NULL, 'chemical',       'special_health',  6,  30, NULL,'산업안전보건법 제130조 (유해인자별)',     true)
ON CONFLICT DO NOTHING;
