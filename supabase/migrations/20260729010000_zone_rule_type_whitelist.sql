-- Whitelist/Blacklist rule_type + displayable zone color for restricted_zones.
ALTER TABLE public.restricted_zones
  ADD COLUMN IF NOT EXISTS rule_type text NOT NULL DEFAULT 'DENY',
  ADD COLUMN IF NOT EXISTS zone_color text NOT NULL DEFAULT '#ef4444';

ALTER TABLE public.restricted_zones
  DROP CONSTRAINT IF EXISTS restricted_zones_rule_type_check;

ALTER TABLE public.restricted_zones
  ADD CONSTRAINT restricted_zones_rule_type_check
  CHECK (rule_type IN ('ALLOW', 'DENY'));

COMMENT ON COLUMN public.restricted_zones.rule_type IS
  'ALLOW = whitelist (지정 대상만 출입 허용), DENY = blacklist (지정 대상 출입 통제)';
COMMENT ON COLUMN public.restricted_zones.zone_color IS
  'UI stroke/fill color for zone polygon/circle (hex)';

-- Backfill from legacy access_rules.mode
UPDATE public.restricted_zones
SET rule_type = CASE
  WHEN access_rules->>'mode' IN ('allow_companies', 'allow_job_types') THEN 'ALLOW'
  ELSE 'DENY'
END
WHERE rule_type IS DISTINCT FROM CASE
  WHEN access_rules->>'mode' IN ('allow_companies', 'allow_job_types') THEN 'ALLOW'
  ELSE 'DENY'
END;

-- Normalize access_rules JSON to include rule_type + target lists
UPDATE public.restricted_zones
SET access_rules = jsonb_build_object(
  'rule_type', rule_type,
  'company_ids', COALESCE(access_rules->'company_ids', '[]'::jsonb),
  'job_types', COALESCE(access_rules->'job_types', '[]'::jsonb),
  'mode', COALESCE(access_rules->>'mode', 'deny_all')
);
