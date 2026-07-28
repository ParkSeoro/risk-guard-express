-- Zone category + access control rules for restricted_zones geofencing.
ALTER TABLE public.restricted_zones
  ADD COLUMN IF NOT EXISTS zone_category text NOT NULL DEFAULT '기타',
  ADD COLUMN IF NOT EXISTS access_rules jsonb NOT NULL DEFAULT '{"mode":"deny_all"}'::jsonb;

COMMENT ON COLUMN public.restricted_zones.zone_category IS
  '위험구역 유형: 추락위험|화재위험|밀폐공간|중장비반입|기타';
COMMENT ON COLUMN public.restricted_zones.access_rules IS
  '출입 통제 JSON: {mode: deny_all|allow_companies|allow_job_types, company_ids?: uuid[], job_types?: string[]}';

CREATE INDEX IF NOT EXISTS idx_restricted_zones_access_rules
  ON public.restricted_zones USING gin (access_rules)
  WHERE is_deleted = false AND is_active = true;
