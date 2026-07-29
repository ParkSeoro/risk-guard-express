-- Document expanded zone_category values including 공정(위험)구역.
COMMENT ON COLUMN public.restricted_zones.zone_category IS
  '위험구역 유형: 공정(위험)구역|추락위험|화재위험|밀폐공간|중장비반입|감전위험|기타';

-- Soft validation helper for app/RPC use (text column stays flexible for legacy rows).
CREATE OR REPLACE FUNCTION public.is_valid_zone_category(_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _value IN (
    '공정(위험)구역',
    '추락위험',
    '화재위험',
    '밀폐공간',
    '중장비반입',
    '감전위험',
    '기타'
  );
$$;
