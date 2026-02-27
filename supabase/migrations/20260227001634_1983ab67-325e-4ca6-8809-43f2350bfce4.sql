
-- Add grade columns to risk_items
ALTER TABLE public.risk_items
  ADD COLUMN IF NOT EXISTS likelihood_grade text NOT NULL DEFAULT '중',
  ADD COLUMN IF NOT EXISTS severity_grade text NOT NULL DEFAULT '중',
  ADD COLUMN IF NOT EXISTS risk_grade text NOT NULL DEFAULT '중',
  ADD COLUMN IF NOT EXISTS improved_likelihood_grade text NOT NULL DEFAULT '하',
  ADD COLUMN IF NOT EXISTS improved_severity_grade text NOT NULL DEFAULT '하',
  ADD COLUMN IF NOT EXISTS improved_risk_grade text NOT NULL DEFAULT '하';

-- Add grade columns to standard_risk_library
ALTER TABLE public.standard_risk_library
  ADD COLUMN IF NOT EXISTS default_likelihood_grade text NOT NULL DEFAULT '중',
  ADD COLUMN IF NOT EXISTS default_severity_grade text NOT NULL DEFAULT '중';

-- Add grade columns to risk_templates
ALTER TABLE public.risk_templates
  ADD COLUMN IF NOT EXISTS likelihood_grade text NOT NULL DEFAULT '중',
  ADD COLUMN IF NOT EXISTS severity_grade text NOT NULL DEFAULT '중',
  ADD COLUMN IF NOT EXISTS improved_likelihood_grade text NOT NULL DEFAULT '하',
  ADD COLUMN IF NOT EXISTS improved_severity_grade text NOT NULL DEFAULT '하';

-- Seed default scoring_config for risk matrix
INSERT INTO public.scoring_config (config_key, config_value, description)
VALUES (
  'risk_matrix_3x3',
  '{"matrix":{"상_상":"상","상_중":"상","중_상":"상","상_하":"중","중_중":"중","하_상":"중","중_하":"하","하_중":"하","하_하":"하"},"colors":{"상":"#ef4444","중":"#eab308","하":"#22c55e"},"labels":{"likelihood":"가능성","severity":"중대성","risk":"위험도"}}'::jsonb,
  '3x3 위험도 매트릭스 설정 (가능성×중대성→위험도)'
)
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;

-- Seed legacy conversion config
INSERT INTO public.scoring_config (config_key, config_value, description)
VALUES (
  'legacy_conversion',
  '{"frequency_to_grade":{"1":"하","2":"하","3":"중","4":"상","5":"상"},"severity_to_grade":{"1":"하","2":"하","3":"중","4":"상","5":"상"},"risk_to_grade":{"low":"하","medium":"중","high":"상"}}'::jsonb,
  '레거시 숫자→등급 변환 규칙'
)
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;

-- Migrate existing data: convert numeric F/S to grades
UPDATE public.risk_items SET
  likelihood_grade = CASE WHEN frequency >= 4 THEN '상' WHEN frequency >= 3 THEN '중' ELSE '하' END,
  severity_grade = CASE WHEN severity >= 4 THEN '상' WHEN severity >= 3 THEN '중' ELSE '하' END,
  improved_likelihood_grade = CASE WHEN improved_frequency >= 4 THEN '상' WHEN improved_frequency >= 3 THEN '중' ELSE '하' END,
  improved_severity_grade = CASE WHEN improved_severity >= 4 THEN '상' WHEN improved_severity >= 3 THEN '중' ELSE '하' END;

-- Compute risk_grade and improved_risk_grade based on matrix
UPDATE public.risk_items SET
  risk_grade = CASE
    WHEN (likelihood_grade = '상' AND severity_grade IN ('상','중')) OR (likelihood_grade = '중' AND severity_grade = '상') THEN '상'
    WHEN (likelihood_grade = '상' AND severity_grade = '하') OR (likelihood_grade = '중' AND severity_grade = '중') OR (likelihood_grade = '하' AND severity_grade = '상') THEN '중'
    ELSE '하'
  END,
  improved_risk_grade = CASE
    WHEN (improved_likelihood_grade = '상' AND improved_severity_grade IN ('상','중')) OR (improved_likelihood_grade = '중' AND improved_severity_grade = '상') THEN '상'
    WHEN (improved_likelihood_grade = '상' AND improved_severity_grade = '하') OR (improved_likelihood_grade = '중' AND improved_severity_grade = '중') OR (improved_likelihood_grade = '하' AND improved_severity_grade = '상') THEN '중'
    ELSE '하'
  END;

-- Migrate library default grades from numeric
UPDATE public.standard_risk_library SET
  default_likelihood_grade = CASE WHEN default_frequency >= 4 THEN '상' WHEN default_frequency >= 3 THEN '중' ELSE '하' END,
  default_severity_grade = CASE WHEN default_severity >= 4 THEN '상' WHEN default_severity >= 3 THEN '중' ELSE '하' END;

-- Add unique constraint on config_key if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scoring_config_config_key_key') THEN
    ALTER TABLE public.scoring_config ADD CONSTRAINT scoring_config_config_key_key UNIQUE (config_key);
  END IF;
END $$;
