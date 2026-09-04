-- Distribution presence zones: 일반 / 작업구역 (no per-worker assignment, no siren).
COMMENT ON COLUMN public.restricted_zones.zone_category IS
  '구역 유형: 일반|작업구역|공정(위험)구역|추락위험|화재위험|밀폐공간|중장비반입|감전위험|기타';

CREATE OR REPLACE FUNCTION public.is_valid_zone_category(_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _value IN (
    '일반',
    '작업구역',
    '공정(위험)구역',
    '추락위험',
    '화재위험',
    '밀폐공간',
    '중장비반입',
    '감전위험',
    '기타'
  );
$$;
