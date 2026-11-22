-- PR 2-A security hardening: enforce active-project management role_new inside
-- location monitoring RPCs so multi-project users who hold a manager role on
-- Project A cannot read worker names/tracking/distribution on Project B where
-- they are only `worker` or `viewer`.

CREATE OR REPLACE FUNCTION public.get_gps_tracking_health(_project_id uuid)
RETURNS TABLE(
  worker_id uuid,
  worker_name text,
  company_id uuid,
  company_name text,
  last_fix_at timestamp with time zone,
  bucket text,
  block_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _role text;
  _is_master boolean;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
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
     AND pm.role_new::text IN (
       'master',
       'project_admin',
       'safety_manager',
       'site_manager',
       'supervisor',
       'site_supervisor'
     )
   ORDER BY CASE pm.role_new::text
     WHEN 'master' THEN 0
     WHEN 'project_admin' THEN 1
     WHEN 'safety_manager' THEN 2
     WHEN 'site_manager' THEN 3
     WHEN 'supervisor' THEN 4
     WHEN 'site_supervisor' THEN 5
     ELSE 10
   END
   LIMIT 1;

  IF NOT _is_master AND _role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH on_site AS (
    SELECT DISTINCT ON (e.worker_id)
      e.worker_id,
      e.entry_at
    FROM public.worker_entry_logs e
    WHERE e.project_id = _project_id
      AND e.exit_at IS NULL
      AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
    ORDER BY e.worker_id, e.entry_at DESC
  ),
  src AS (
    SELECT
      w.id AS worker_id,
      w.name AS worker_name,
      COALESCE(wlp.company_id, st.company_id, w.company_id) AS company_id,
      CASE
        WHEN wlp.updated_at IS NOT NULL
         AND wlp.updated_at >= o.entry_at - interval '10 minutes'
        THEN wlp.updated_at
        ELSE NULL
      END AS last_fix_at,
      CASE
        WHEN st.block_reason IS NOT NULL
         AND btrim(st.block_reason) <> ''
         AND st.block_reason <> 'no_checkin'
        THEN st.block_reason
        ELSE NULL
      END AS block_reason
    FROM on_site o
    JOIN public.workers w ON w.id = o.worker_id
    LEFT JOIN public.worker_last_positions wlp
      ON wlp.worker_id = w.id
     AND wlp.project_id = _project_id
    LEFT JOIN public.worker_gps_status st
      ON st.worker_id = w.id
     AND st.project_id = _project_id
    WHERE w.project_id = _project_id
      AND COALESCE(w.is_active, true) = true
  )
  SELECT
    s.worker_id,
    s.worker_name,
    s.company_id,
    COALESCE(c.name, '(미지정)') AS company_name,
    s.last_fix_at,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_worker_distribution_counts(_project_id uuid)
RETURNS TABLE(company_id uuid, company_name text, zone_id uuid, headcount bigint, stale_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _role text;
  _is_master boolean;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  _general_id uuid;
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
     AND pm.role_new::text IN (
       'master',
       'project_admin',
       'safety_manager',
       'site_manager',
       'supervisor',
       'site_supervisor'
     )
   ORDER BY CASE pm.role_new::text
     WHEN 'master' THEN 0
     WHEN 'project_admin' THEN 1
     WHEN 'safety_manager' THEN 2
     WHEN 'site_manager' THEN 3
     WHEN 'supervisor' THEN 4
     WHEN 'site_supervisor' THEN 5
     ELSE 10
   END
   LIMIT 1;

  IF NOT _is_master AND _role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT rz.id
    INTO _general_id
    FROM public.restricted_zones rz
   WHERE rz.project_id = _project_id
     AND COALESCE(rz.is_deleted, false) = false
     AND COALESCE(rz.is_active, true) = true
     AND rz.zone_category = '일반'
   ORDER BY rz.created_at
   LIMIT 1;

  RETURN QUERY
  WITH on_site AS (
    SELECT DISTINCT ON (e.worker_id) e.worker_id, e.entry_at
    FROM public.worker_entry_logs e
    WHERE e.project_id = _project_id
      AND e.exit_at IS NULL
      AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
    ORDER BY e.worker_id, e.entry_at DESC
  ),
  located AS (
    SELECT
      COALESCE(wlp.company_id, w.company_id) AS company_id,
      COALESCE(c.name, w.company_name, '(미지정)') AS company_name,
      COALESCE(
        CASE
          WHEN wlp.updated_at IS NOT NULL
           AND wlp.updated_at >= (now() - interval '12 hours')
           AND wlp.zone_id IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM public.restricted_zones rz
             WHERE rz.id = wlp.zone_id
               AND COALESCE(rz.is_deleted, false) = false
               AND rz.zone_category IS DISTINCT FROM '일반'
           )
          THEN wlp.zone_id
          ELSE NULL
        END,
        _general_id
      ) AS zone_id,
      wlp.updated_at
    FROM on_site o
    JOIN public.workers w ON w.id = o.worker_id
    LEFT JOIN public.worker_last_positions wlp
      ON wlp.worker_id = o.worker_id
     AND wlp.project_id = _project_id
    LEFT JOIN public.companies c ON c.id = COALESCE(wlp.company_id, w.company_id)
    WHERE (
      _is_master
      OR public.can_access_company_data(_uid, _project_id, COALESCE(wlp.company_id, w.company_id))
    )
  )
  SELECT
    s.company_id,
    s.company_name,
    s.zone_id,
    count(*)::bigint AS headcount,
    count(*) FILTER (
      WHERE s.updated_at IS NULL OR s.updated_at < (now() - interval '30 minutes')
    )::bigint AS stale_count
  FROM located s
  GROUP BY s.company_id, s.company_name, s.zone_id
  ORDER BY s.company_name, s.zone_id NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_worker_distribution_positions(_project_id uuid)
RETURNS TABLE(company_id uuid, company_name text, lat double precision, lng double precision, accuracy_m double precision, updated_at timestamp with time zone, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _role text;
  _is_master boolean;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
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
     AND pm.role_new::text IN (
       'master',
       'project_admin',
       'safety_manager',
       'site_manager',
       'supervisor',
       'site_supervisor'
     )
   ORDER BY CASE pm.role_new::text
     WHEN 'master' THEN 0
     WHEN 'project_admin' THEN 1
     WHEN 'safety_manager' THEN 2
     WHEN 'site_manager' THEN 3
     WHEN 'supervisor' THEN 4
     WHEN 'site_supervisor' THEN 5
     ELSE 10
   END
   LIMIT 1;

  IF NOT _is_master AND _role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH on_site AS (
    SELECT DISTINCT ON (e.worker_id) e.worker_id, e.project_id
    FROM public.worker_entry_logs e
    WHERE e.project_id = _project_id
      AND e.exit_at IS NULL
      AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
    ORDER BY e.worker_id, e.entry_at DESC
  )
  SELECT
    COALESCE(wlp.company_id, w.company_id) AS company_id,
    COALESCE(c.name, w.company_name, '(미지정)') AS company_name,
    wlp.lat,
    wlp.lng,
    wlp.accuracy_m,
    wlp.updated_at,
    wlp.source
  FROM on_site o
  JOIN public.workers w ON w.id = o.worker_id
  JOIN public.worker_last_positions wlp
    ON wlp.worker_id = o.worker_id
   AND wlp.project_id = o.project_id
  LEFT JOIN public.companies c ON c.id = COALESCE(wlp.company_id, w.company_id)
  WHERE wlp.lat IS NOT NULL
    AND wlp.lng IS NOT NULL
    AND (
      _is_master
      OR public.can_access_company_data(_uid, _project_id, COALESCE(wlp.company_id, w.company_id))
    )
  ORDER BY wlp.updated_at DESC;
END;
$function$;
