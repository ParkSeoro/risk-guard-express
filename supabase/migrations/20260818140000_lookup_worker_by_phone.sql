-- Phone-digit worker lookup (no LIMIT+JS scan).
-- Used by track-location and the worker GPS client so a 300/80-row page
-- cannot miss the authenticated user and 403 their GPS.

CREATE OR REPLACE FUNCTION public.lookup_project_worker_by_phone(
  _project_id uuid,
  _phone text
)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  job_type text,
  name text,
  phone text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _digits text := public.normalize_phone_digits(_phone);
BEGIN
  IF _project_id IS NULL OR _digits IS NULL OR _digits = '' THEN
    RETURN;
  END IF;

  -- service_role / edge: auth.uid() is null → allow.
  -- authenticated: master or project member only (do not leak other sites' roster).
  IF auth.uid() IS NOT NULL
     AND NOT public.is_master(auth.uid())
     AND NOT public.is_project_member(auth.uid(), _project_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT w.id, w.company_id, w.job_type, w.name, w.phone
    FROM public.workers w
   WHERE w.project_id = _project_id
     AND COALESCE(w.is_active, true) = true
     AND public.normalize_phone_digits(w.phone) = _digits
   LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_project_worker_by_phone(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_project_worker_by_phone(uuid, text) TO authenticated, service_role;

-- GPS status chip: identity_mismatch (track-location 403).
ALTER TABLE public.worker_gps_status
  DROP CONSTRAINT IF EXISTS worker_gps_status_reason_chk;

ALTER TABLE public.worker_gps_status
  ADD CONSTRAINT worker_gps_status_reason_chk CHECK (
    block_reason IS NULL
    OR block_reason IN (
      'no_consent',
      'no_permission',
      'no_checkin',
      'fence_probe_failed',
      'identity_mismatch'
    )
  );

CREATE OR REPLACE FUNCTION public.report_worker_gps_status(
  _project_id uuid,
  _block_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _wid uuid;
  _cid uuid;
  _reason text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.is_master(_uid)
     AND NOT EXISTS (
       SELECT 1
         FROM public.project_members pm
        WHERE pm.project_id = _project_id
          AND pm.user_id = _uid
     ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  _reason := NULLIF(btrim(COALESCE(_block_reason, '')), '');
  IF _reason IS NOT NULL
     AND _reason NOT IN (
       'no_consent',
       'no_permission',
       'no_checkin',
       'fence_probe_failed',
       'identity_mismatch'
     ) THEN
    RAISE EXCEPTION 'INVALID_REASON';
  END IF;

  SELECT lw.id, lw.company_id
    INTO _wid, _cid
    FROM public.lookup_project_worker_by_phone(
      _project_id,
      (SELECT p.phone FROM public.profiles p WHERE p.user_id = _uid LIMIT 1)
    ) lw;

  IF _wid IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.worker_gps_status (worker_id, project_id, company_id, block_reason, updated_at)
  VALUES (_wid, _project_id, _cid, _reason, now())
  ON CONFLICT (worker_id) DO UPDATE
    SET project_id = EXCLUDED.project_id,
        company_id = EXCLUDED.company_id,
        block_reason = EXCLUDED.block_reason,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.report_worker_gps_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_worker_gps_status(uuid, text) TO authenticated, service_role;
