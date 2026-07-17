-- Fix zone_qr_codes anon read exposure: replace full-table anon SELECT with a
-- SECURITY DEFINER RPC that only returns one row for an exact code match.

DROP POLICY IF EXISTS "anon view active qr" ON public.zone_qr_codes;

CREATE OR REPLACE FUNCTION public.lookup_zone_qr_by_code(_code text)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  zone_id uuid,
  code text,
  direction text,
  is_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, project_id, zone_id, code, direction, is_active
  FROM public.zone_qr_codes
  WHERE code = _code
    AND is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_zone_qr_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_zone_qr_by_code(text) TO anon, authenticated;
