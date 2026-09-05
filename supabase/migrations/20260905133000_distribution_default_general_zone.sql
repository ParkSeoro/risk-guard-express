-- Checked-in workers are on site. The sitemap default zone is 일반, not 미지정.

CREATE OR REPLACE FUNCTION public.get_worker_distribution_counts(_project_id uuid)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  zone_id uuid,
  headcount bigint,
  stale_count bigint
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
    SELECT e.worker_id, e.entry_at
    FROM public.worker_entry_logs e
    WHERE e.project_id = _project_id
      AND e.exit_at IS NULL
      AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
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
$$;

COMMENT ON FUNCTION public.get_worker_distribution_counts(uuid) IS
  '오늘 미퇴근 출근자 집계. 작업·위험 GPS가 있으면 그 구역, 없으면 일반. 미지정 없음.';
