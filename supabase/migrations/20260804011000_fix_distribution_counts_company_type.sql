-- Hotfix: companies.type (not company_type)
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
  _ctype text;
  _my_company uuid;
  _is_master boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  _is_master := public.is_master(_uid);

  SELECT pm.role_new::text, c.type::text, pm.company_id
    INTO _role, _ctype, _my_company
    FROM public.project_members pm
    LEFT JOIN public.companies c ON c.id = pm.company_id
   WHERE pm.project_id = _project_id
     AND pm.user_id = _uid
     AND COALESCE(pm.is_active, true) = true
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
  WITH scoped AS (
    SELECT
      wlp.company_id,
      COALESCE(c.name, '(미지정)') AS company_name,
      wlp.zone_id,
      wlp.updated_at
    FROM public.worker_last_positions wlp
    LEFT JOIN public.companies c ON c.id = wlp.company_id
    WHERE wlp.project_id = _project_id
      AND wlp.updated_at >= (now() - interval '12 hours')
      AND (
        _is_master
        OR public.can_access_company_data(_uid, _project_id, wlp.company_id)
      )
  )
  SELECT
    s.company_id,
    s.company_name,
    s.zone_id,
    count(*)::bigint AS headcount,
    count(*) FILTER (WHERE s.updated_at < (now() - interval '30 minutes'))::bigint AS stale_count
  FROM scoped s
  GROUP BY s.company_id, s.company_name, s.zone_id
  ORDER BY s.company_name, s.zone_id NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_worker_distribution_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_worker_distribution_counts(uuid) TO authenticated, service_role;
