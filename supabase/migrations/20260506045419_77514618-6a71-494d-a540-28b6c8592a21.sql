
-- worker_opinions 근로자 의견
CREATE TABLE public.worker_opinions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  opinion_text text NOT NULL DEFAULT '',
  worker_name text NOT NULL DEFAULT '',
  worker_company text NOT NULL DEFAULT '',
  worker_position text NOT NULL DEFAULT '',
  signature_url text DEFAULT '',
  participated_at date DEFAULT CURRENT_DATE,
  analysis_status text NOT NULL DEFAULT 'pending', -- pending | analyzing | done | failed
  analysis_result jsonb DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_worker_opinions_run ON public.worker_opinions(run_id);

ALTER TABLE public.worker_opinions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view worker opinions" ON public.worker_opinions FOR SELECT TO authenticated
  USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert worker opinions" ON public.worker_opinions FOR INSERT TO authenticated
  WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update worker opinions" ON public.worker_opinions FOR UPDATE TO authenticated
  USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can delete worker opinions" ON public.worker_opinions FOR DELETE TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE TRIGGER trg_worker_opinions_updated_at BEFORE UPDATE ON public.worker_opinions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- health_hazards 보건 유해요인
CREATE TABLE public.health_hazards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  category text NOT NULL DEFAULT '분진', -- 분진/소음/화학물질/고온저온/밀폐공간/진동/기타
  process text DEFAULT '',
  description text DEFAULT '',
  exposure_level text DEFAULT '', -- 낮음/보통/높음
  countermeasure text DEFAULT '',
  legal_basis text DEFAULT '',
  source_type text NOT NULL DEFAULT 'manual', -- manual | ai
  is_user_reviewed boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_health_hazards_run ON public.health_hazards(run_id);

ALTER TABLE public.health_hazards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view health hazards" ON public.health_hazards FOR SELECT TO authenticated
  USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert health hazards" ON public.health_hazards FOR INSERT TO authenticated
  WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update health hazards" ON public.health_hazards FOR UPDATE TO authenticated
  USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can delete health hazards" ON public.health_hazards FOR DELETE TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE TRIGGER trg_health_hazards_updated_at BEFORE UPDATE ON public.health_hazards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- assessment_accidents 회차별 사고사례
CREATE TABLE public.assessment_accidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  process text DEFAULT '',
  accident_type text DEFAULT '',
  cause text DEFAULT '',
  result text DEFAULT '',
  prevention text DEFAULT '',
  description text DEFAULT '',
  occurrence_date date,
  photo_urls text[] DEFAULT ARRAY[]::text[],
  source_type text NOT NULL DEFAULT 'manual', -- manual | recommended | ai
  reference_case_id uuid, -- accident_cases 참조
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assessment_accidents_run ON public.assessment_accidents(run_id);

ALTER TABLE public.assessment_accidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view run accidents" ON public.assessment_accidents FOR SELECT TO authenticated
  USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert run accidents" ON public.assessment_accidents FOR INSERT TO authenticated
  WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update run accidents" ON public.assessment_accidents FOR UPDATE TO authenticated
  USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can delete run accidents" ON public.assessment_accidents FOR DELETE TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE TRIGGER trg_assessment_accidents_updated_at BEFORE UPDATE ON public.assessment_accidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- risk_items 확장
ALTER TABLE public.risk_items
  ADD COLUMN IF NOT EXISTS item_category text NOT NULL DEFAULT 'safety',
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_opinion_id uuid,
  ADD COLUMN IF NOT EXISTS is_user_reviewed boolean NOT NULL DEFAULT true;

-- assessment_runs 확장
ALTER TABLE public.assessment_runs
  ADD COLUMN IF NOT EXISTS tbm_images text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS opinion_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS health_required boolean NOT NULL DEFAULT true;
