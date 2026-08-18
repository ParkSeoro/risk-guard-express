-- GPS tracking health (F-08): heartbeat from worker_last_positions
-- plus a coordinate-free status table so "why GPS is off" is visible
-- without writing a location.

CREATE TABLE IF NOT EXISTS public.worker_gps_status (
  worker_id uuid PRIMARY KEY REFERENCES public.workers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  block_reason text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_gps_status_reason_chk CHECK (
    block_reason IS NULL
    OR block_reason IN ('no_consent', 'no_permission', 'no_checkin', 'fence_probe_failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_worker_gps_status_project
  ON public.worker_gps_status (project_id, updated_at DESC);

ALTER TABLE public.worker_gps_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS worker_gps_status_select ON public.worker_gps_status;
CREATE POLICY worker_gps_status_select ON public.worker_gps_status
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR (
      company_id IS NOT NULL
      AND public.can_access_company_data(auth.uid(), project_id, company_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.worker_gps_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.worker_gps_status TO authenticated;
GRANT ALL ON public.worker_gps_status TO service_role;

-- Client reports a status only (no lat/lng). Resolves roster worker from JWT phone.
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
  _digits text;
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
     AND _reason NOT IN ('no_consent', 'no_permission', 'no_checkin', 'fence_probe_failed') THEN
    RAISE EXCEPTION 'INVALID_REASON';
  END IF;

  SELECT regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g')
    INTO _digits
    FROM public.profiles p
   WHERE p.user_id = _uid
   LIMIT 1;

  IF _digits IS NULL OR _digits = '' THEN
    RETURN;
  END IF;

  SELECT w.id, w.company_id
    INTO _wid, _cid
    FROM public.workers w
   WHERE w.project_id = _project_id
     AND w.is_active = true
     AND regexp_replace(COALESCE(w.phone, ''), '\D', '', 'g') = _digits
   LIMIT 1;

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

-- Project GPS heartbeat. No coordinates. Same company scope as distribution counts.
CREATE OR REPLACE FUNCTION public.get_gps_tracking_health(_project_id uuid)
RETURNS TABLE (
  worker_id uuid,
  worker_name text,
  company_id uuid,
  company_name text,
  last_fix_at timestamptz,
  bucket text,
  block_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _is_master boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  _is_master := public.is_master(_uid);

  SELECT pm.role_new::text
    INTO _role
    FROM public.project_members pm
   WHERE pm.project_id = _project_id
     AND pm.user_id = _uid
   ORDER BY CASE pm.role_new::text
     WHEN 'master' THEN 0
     WHEN 'project_admin' THEN 1
     WHEN 'safety_manager' THEN 2
     ELSE 10
   END
   LIMIT 1;

  IF NOT _is_master AND _role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH src AS (
    SELECT
      w.id AS worker_id,
      w.name AS worker_name,
      COALESCE(wlp.company_id, st.company_id, w.company_id) AS company_id,
      wlp.updated_at AS last_fix_at,
      st.block_reason
    FROM public.workers w
    LEFT JOIN public.worker_last_positions wlp
      ON wlp.worker_id = w.id
     AND wlp.project_id = _project_id
    LEFT JOIN public.worker_gps_status st
      ON st.worker_id = w.id
     AND st.project_id = _project_id
    WHERE w.project_id = _project_id
      AND w.is_active = true
      AND (
        (wlp.updated_at IS NOT NULL AND wlp.updated_at >= now() - interval '12 hours')
        OR (st.updated_at IS NOT NULL AND st.updated_at >= now() - interval '12 hours')
      )
  )
  SELECT
    s.worker_id,
    s.worker_name,
    s.company_id,
    COALESCE(c.name, '(미지정)') AS company_name,
    s.last_fix_at,
    -- Bucket from last_positions only. A fresh status row (e.g. no_checkin)
    -- must not look "live" without a location ping.
    CASE
      WHEN s.last_fix_at IS NOT NULL AND s.last_fix_at >= now() - interval '5 minutes' THEN 'live'
      WHEN s.last_fix_at IS NOT NULL AND s.last_fix_at >= now() - interval '30 minutes' THEN 'delayed'
      ELSE 'disconnected'
    END AS bucket,
    s.block_reason
  FROM src s
  LEFT JOIN public.companies c ON c.id = s.company_id
  WHERE
    _is_master
    OR public.can_access_company_data(_uid, _project_id, s.company_id)
  ORDER BY
    CASE
      WHEN s.last_fix_at IS NULL OR s.last_fix_at < now() - interval '30 minutes' THEN 0
      WHEN s.last_fix_at < now() - interval '5 minutes' THEN 1
      ELSE 2
    END,
    s.last_fix_at NULLS FIRST,
    s.worker_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_gps_tracking_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gps_tracking_health(uuid) TO authenticated, service_role;
