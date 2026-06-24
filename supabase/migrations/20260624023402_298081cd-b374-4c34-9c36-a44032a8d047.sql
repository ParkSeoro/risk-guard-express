
-- 1) chemical_usage_plans: 화학물질 월간/연간 사용계획 (산안법 제114조·화관법 시행규칙 제19조 연간 취급계획서)
CREATE TABLE IF NOT EXISTS public.chemical_usage_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id),
  chemical_id UUID REFERENCES public.chemicals(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('annual','monthly')),
  year INT NOT NULL,
  month INT, -- 1..12, null for annual
  planned_qty NUMERIC,
  actual_qty NUMERIC,
  unit TEXT,
  storage_max_qty NUMERIC,
  legal_basis TEXT,
  notes TEXT,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chemical_usage_plans TO authenticated;
GRANT ALL ON public.chemical_usage_plans TO service_role;

ALTER TABLE public.chemical_usage_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cup_select" ON public.chemical_usage_plans
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "cup_write" ON public.chemical_usage_plans
  FOR ALL TO authenticated
  USING (public.can_write_company_data(auth.uid(), project_id, company_id))
  WITH CHECK (public.can_write_company_data(auth.uid(), project_id, company_id));

CREATE TRIGGER trg_cup_updated_at
  BEFORE UPDATE ON public.chemical_usage_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_cup_project ON public.chemical_usage_plans(project_id) WHERE is_deleted = false;
CREATE INDEX idx_cup_chem ON public.chemical_usage_plans(chemical_id);

-- 2) special_health_management: 특수건강관리 대상 작업 (산안법 시행규칙 제202조 — 소음/분진/유기용제/중금속/야간작업 등)
CREATE TABLE IF NOT EXISTS public.special_health_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id),
  worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
  hazard_type TEXT NOT NULL, -- noise/dust/organic_solvent/heavy_metal/night_shift/vibration/musculoskeletal
  exposure_started_at DATE,
  required_checkup_interval_months INT, -- 6 or 12 typical
  next_checkup_due DATE,
  legal_basis TEXT,
  notes TEXT,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.special_health_targets TO authenticated;
GRANT ALL ON public.special_health_targets TO service_role;

ALTER TABLE public.special_health_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sht_select" ON public.special_health_targets
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "sht_write" ON public.special_health_targets
  FOR ALL TO authenticated
  USING (public.can_write_company_data(auth.uid(), project_id, company_id))
  WITH CHECK (public.can_write_company_data(auth.uid(), project_id, company_id));

CREATE TRIGGER trg_sht_updated_at
  BEFORE UPDATE ON public.special_health_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_sht_project ON public.special_health_targets(project_id) WHERE is_deleted = false;

-- 3) confined_space_permits: 밀폐공간 작업 허가 (산안법 제619조의2 — 산소·유해가스 측정 의무)
CREATE TABLE IF NOT EXISTS public.confined_space_permits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id),
  work_permit_id UUID REFERENCES public.work_permits(id) ON DELETE SET NULL,
  location TEXT NOT NULL,
  work_date DATE NOT NULL,
  o2_pct NUMERIC,
  co_ppm NUMERIC,
  h2s_ppm NUMERIC,
  flammable_lel_pct NUMERIC,
  measured_at TIMESTAMPTZ,
  measured_by TEXT,
  ventilation_method TEXT,
  rescue_plan TEXT,
  supervisor_name TEXT,
  is_safe BOOLEAN,
  notes TEXT,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.confined_space_permits TO authenticated;
GRANT ALL ON public.confined_space_permits TO service_role;

ALTER TABLE public.confined_space_permits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "csp_select" ON public.confined_space_permits
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "csp_write" ON public.confined_space_permits
  FOR ALL TO authenticated
  USING (public.can_write_company_data(auth.uid(), project_id, company_id))
  WITH CHECK (public.can_write_company_data(auth.uid(), project_id, company_id));

CREATE TRIGGER trg_csp_updated_at
  BEFORE UPDATE ON public.confined_space_permits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_csp_project ON public.confined_space_permits(project_id) WHERE is_deleted = false;

-- 4) musculoskeletal_surveys: 근골격계부담작업 유해요인조사 (산안법 제658조 — 3년 주기)
CREATE TABLE IF NOT EXISTS public.musculoskeletal_surveys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id),
  survey_date DATE NOT NULL,
  next_due_date DATE, -- usually +3 years
  process_name TEXT,
  task_description TEXT,
  worker_count INT,
  symptom_count INT,
  risk_level TEXT, -- low/medium/high
  improvement_plan TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  legal_basis TEXT DEFAULT '산업안전보건법 제658조, 시행규칙 제657조',
  is_deleted BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.musculoskeletal_surveys TO authenticated;
GRANT ALL ON public.musculoskeletal_surveys TO service_role;

ALTER TABLE public.musculoskeletal_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mss_select" ON public.musculoskeletal_surveys
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "mss_write" ON public.musculoskeletal_surveys
  FOR ALL TO authenticated
  USING (public.can_write_company_data(auth.uid(), project_id, company_id))
  WITH CHECK (public.can_write_company_data(auth.uid(), project_id, company_id));

CREATE TRIGGER trg_mss_updated_at
  BEFORE UPDATE ON public.musculoskeletal_surveys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_mss_project ON public.musculoskeletal_surveys(project_id) WHERE is_deleted = false;

-- 5) Add company_id to existing chemicals rows from inserter (default null OK; existing policy supports it).
-- No-op SQL; column already exists.
