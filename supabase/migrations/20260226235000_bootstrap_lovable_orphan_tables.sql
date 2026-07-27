-- Bootstrap tables that existed on Lovable Cloud but were never captured
-- in early migration CREATE TABLE statements. Safe/idempotent for fresh projects.
-- Placed after 20260226234040 and before 20260227001634.

CREATE TABLE IF NOT EXISTS public.scoring_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL UNIQUE,
  config_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.scoring_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scoring_config' AND policyname='Anyone can read scoring_config'
  ) THEN
    CREATE POLICY "Anyone can read scoring_config"
      ON public.scoring_config FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.standard_risk_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_large text NOT NULL DEFAULT '',
  category_medium text NOT NULL DEFAULT '',
  category_small text NOT NULL DEFAULT '',
  sub_task text NOT NULL DEFAULT '',
  hazard text NOT NULL DEFAULT '',
  hazard_situation text NOT NULL DEFAULT '',
  existing_measure text,
  improvement_measure text,
  default_frequency integer DEFAULT 3,
  default_severity integer DEFAULT 3,
  equipment text[] DEFAULT ARRAY[]::text[],
  recommended_ppe text[] DEFAULT ARRAY[]::text[],
  legal_refs text[] DEFAULT ARRAY[]::text[],
  keywords text[] DEFAULT ARRAY[]::text[],
  synonyms text[] DEFAULT ARRAY[]::text[],
  tags text[] DEFAULT ARRAY[]::text[],
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.standard_risk_library ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='standard_risk_library' AND policyname='Anyone can read standard_risk_library'
  ) THEN
    CREATE POLICY "Anyone can read standard_risk_library"
      ON public.standard_risk_library FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- validation_results base (run_id added in later migration)
CREATE TABLE IF NOT EXISTS public.validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  risk_item_id uuid REFERENCES public.risk_items(id) ON DELETE SET NULL,
  rule_id text,
  status text NOT NULL DEFAULT 'fail',
  message text,
  batch_id text,
  validated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.validation_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='validation_results' AND policyname='Members can view validation_results'
  ) THEN
    CREATE POLICY "Members can view validation_results"
      ON public.validation_results FOR SELECT TO authenticated
      USING (public.is_project_member(auth.uid(), project_id));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='validation_results' AND policyname='Members can insert validation_results'
  ) THEN
    CREATE POLICY "Members can insert validation_results"
      ON public.validation_results FOR INSERT TO authenticated
      WITH CHECK (public.is_project_member(auth.uid(), project_id));
  END IF;
END $$;
