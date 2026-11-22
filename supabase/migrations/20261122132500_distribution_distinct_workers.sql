-- PR 1-C: Deduplicate open worker_entry_logs per worker_id in distribution RPCs
-- so "현재 현장 체류" matches COUNT(DISTINCT worker_id) across Dashboard,
-- WorkerAttendance, WorkerDistribution, and MobileToday.

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
