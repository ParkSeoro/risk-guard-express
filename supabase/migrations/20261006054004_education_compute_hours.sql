CREATE OR REPLACE FUNCTION public.compute_worker_required_education(_worker_id uuid)
RETURNS TABLE (
  job_type text,
  education_type text,
  required_hours numeric,
  interval_months int,
  first_due_days int,
  legal_basis text,
  next_due_at date,
  last_completed_at date,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w RECORD;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT id, project_id, workers.job_type, hire_date INTO w
  FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH mapping AS (
    SELECT DISTINCT ON (m.education_type)
      m.job_type, m.education_type, m.required_hours, m.interval_months,
      m.first_due_days, m.legal_basis
    FROM public.worker_legal_education_mapping m
    WHERE COALESCE(m.is_deleted, false) = false
      AND (
        m.job_type = public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general'))
        OR m.job_type = 'all'
      )
      AND (m.is_system_default = true OR m.project_id = w.project_id)
    ORDER BY m.education_type, (m.project_id = w.project_id) DESC
  ),
  latest AS (
    SELECT public.education_record_requirement_subtype(r.education_type) AS education_type,
           MAX(r.completed_at) AS last_completed_at
    FROM public.worker_education_records r
    WHERE r.worker_id = _worker_id AND COALESCE(r.is_deleted, false) = false
    GROUP BY 1
  ),
  bounds AS (
    SELECT mp.education_type, win.end_on
    FROM mapping mp
    LEFT JOIN LATERAL public.education_hour_window(mp.education_type, _today) win ON true
  )
  SELECT
    mp.job_type, mp.education_type, mp.required_hours, mp.interval_months,
    mp.first_due_days, mp.legal_basis,
    CASE
      WHEN mp.education_type IN ('regular', 'manager') THEN b.end_on
      WHEN public.education_hours_met(_worker_id, mp.education_type, _today) THEN NULL
      ELSE (COALESCE(w.hire_date, _today) + (mp.first_due_days || ' days')::interval)::date
    END AS next_due_at,
    l.last_completed_at,
    CASE
      WHEN public.education_hours_met(_worker_id, mp.education_type, _today) THEN 'ok'
      WHEN mp.education_type = 'regular' AND b.end_on IS NOT NULL AND (b.end_on - _today) <= 30 THEN 'due_soon'
      WHEN mp.education_type = 'manager' AND b.end_on IS NOT NULL AND (b.end_on - _today) <= 30 THEN 'due_soon'
      WHEN COALESCE(mp.interval_months, 0) = 0
           AND (COALESCE(w.hire_date, _today) + (mp.first_due_days || ' days')::interval)::date < _today
        THEN 'overdue'
      WHEN COALESCE(mp.interval_months, 0) > 0
           AND (COALESCE(w.hire_date, _today) + (mp.first_due_days || ' days')::interval)::date < _today
        THEN 'overdue'
      ELSE 'missing'
    END AS status
  FROM mapping mp
  LEFT JOIN latest l ON l.education_type = mp.education_type
  LEFT JOIN bounds b ON b.education_type = mp.education_type;
END;
$$;
