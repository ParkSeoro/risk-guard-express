-- Auto-close TBM sessions whose work date has passed (Asia/Seoul calendar day).
CREATE OR REPLACE FUNCTION public.close_expired_tbm_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date := (timezone('Asia/Seoul', now()))::date;
  _n integer;
BEGIN
  UPDATE public.tbm_sessions
  SET is_active = false
  WHERE is_active IS TRUE
    AND tbm_date IS NOT NULL
    AND tbm_date < _today
    AND COALESCE(is_deleted, false) = false;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

COMMENT ON FUNCTION public.close_expired_tbm_sessions() IS
  'Sets is_active=false for TBM sessions with tbm_date before today (KST).';

GRANT EXECUTE ON FUNCTION public.close_expired_tbm_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_expired_tbm_sessions() TO service_role;
