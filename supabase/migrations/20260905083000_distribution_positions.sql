-- Anonymous last-known GPS for today's open check-ins (no name/phone).
-- Distribution map plots these on a georeferenced sitemap when site_zones are empty.

CREATE OR REPLACE FUNCTION public.get_worker_distribution_positions(_project_id uuid)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  updated_at timestamptz
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
  SELECT
    COALESCE(wlp.company_id, w.company_id) AS company_id,
    COALESCE(c.name, w.company_name, '(미지정)') AS company_name,
    wlp.lat,
    wlp.lng,
    wlp.accuracy_m,
    wlp.updated_at
  FROM public.worker_entry_logs e
  JOIN public.workers w ON w.id = e.worker_id
  JOIN public.worker_last_positions wlp
    ON wlp.worker_id = e.worker_id
   AND wlp.project_id = e.project_id
  LEFT JOIN public.companies c ON c.id = COALESCE(wlp.company_id, w.company_id)
  WHERE e.project_id = _project_id
    AND e.exit_at IS NULL
    AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
    AND wlp.lat IS NOT NULL
    AND wlp.lng IS NOT NULL
    AND (
      _is_master
      OR public.can_access_company_data(_uid, _project_id, COALESCE(wlp.company_id, w.company_id))
    )
  ORDER BY wlp.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_worker_distribution_positions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_worker_distribution_positions(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_worker_distribution_positions(uuid) IS
  '오늘 미퇴근 출근자의 최근 GPS (이름·전화 없음). 분포도 점 표시용.';
