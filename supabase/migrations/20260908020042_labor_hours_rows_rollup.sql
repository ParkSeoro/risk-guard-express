CREATE OR REPLACE FUNCTION public.get_work_hours_rows(_project_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.labor_assert_project_read(_project_id);
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN RAISE EXCEPTION 'invalid_range'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.work_date DESC, x.entry_at DESC)
    FROM (
      SELECT e.id AS entry_log_id, e.worker_id, w.name AS worker_name, w.phone AS worker_phone,
        COALESCE(NULLIF(trim(w.job_type), ''), '미분류') AS job_type, w.company_id,
        COALESCE(NULLIF(trim(w.company_name), ''), '미분류') AS company_name,
        (e.entry_at AT TIME ZONE 'Asia/Seoul')::date AS work_date, e.entry_at, e.exit_at,
        CASE WHEN e.exit_at IS NULL THEN NULL ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (e.exit_at - e.entry_at)) / 60))::int END AS minutes,
        CASE WHEN e.exit_at IS NULL THEN NULL ELSE GREATEST(0.25, ROUND((GREATEST(0, EXTRACT(EPOCH FROM (e.exit_at - e.entry_at)) / 60) / 480.0)::numeric, 2)) END AS man_days,
        public.labor_night_minutes(e.entry_at, e.exit_at) AS night_minutes,
        (e.exit_at IS NULL) AS incomplete,
        (EXTRACT(ISODOW FROM (e.entry_at AT TIME ZONE 'Asia/Seoul')::date) = 7) AS sunday,
        e.entry_method, e.no_accident_confirmed, e.tbm_confirmed, e.risk_assessment_confirmed, e.education_confirmed,
        EXISTS (SELECT 1 FROM public.worker_entry_corrections c WHERE c.entry_log_id = e.id) AS corrected
      FROM public.worker_entry_logs e
      JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id
        AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN _from AND _to
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ) x
  ), '[]'::jsonb);
END;$$;

CREATE OR REPLACE FUNCTION public.get_work_hours_rollup(_project_id uuid, _from date, _to date, _group text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_group text := COALESCE(NULLIF(trim(_group), ''), 'worker');
BEGIN
  v_rows := public.get_work_hours_rows(_project_id, _from, _to);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(g) ORDER BY g.minutes DESC, g.label)
    FROM (
      SELECT
        CASE v_group WHEN 'job_type' THEN COALESCE(r.job_type, '미분류') WHEN 'company' THEN COALESCE(r.company_id::text, r.company_name, '미분류') WHEN 'project' THEN _project_id::text ELSE r.worker_id::text END AS key,
        CASE v_group WHEN 'job_type' THEN COALESCE(r.job_type, '미분류') WHEN 'company' THEN COALESCE(r.company_name, '미분류') WHEN 'project' THEN '전체' ELSE COALESCE(r.worker_name, r.worker_id::text) END AS label,
        COUNT(DISTINCT r.worker_id)::int AS worker_count,
        COUNT(DISTINCT r.work_date)::int AS day_count,
        COALESCE(SUM(r.minutes) FILTER (WHERE r.minutes IS NOT NULL), 0)::int AS minutes,
        COALESCE(SUM(r.man_days) FILTER (WHERE r.man_days IS NOT NULL), 0) AS man_days,
        COALESCE(SUM(r.night_minutes), 0)::int AS night_minutes,
        COUNT(*) FILTER (WHERE r.incomplete)::int AS incomplete_count,
        COALESCE(SUM(r.minutes) FILTER (WHERE r.sunday AND r.minutes IS NOT NULL), 0)::int AS sunday_minutes
      FROM jsonb_to_recordset(v_rows) AS r(worker_id uuid, worker_name text, job_type text, company_id uuid, company_name text, work_date date, minutes int, man_days numeric, night_minutes int, incomplete boolean, sunday boolean)
      GROUP BY 1, 2
    ) g
  ), '[]'::jsonb);
END;$$;

REVOKE ALL ON FUNCTION public.get_work_hours_rows(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_work_hours_rollup(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_work_hours_rows(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_work_hours_rollup(uuid, date, date, text) TO authenticated, service_role;
