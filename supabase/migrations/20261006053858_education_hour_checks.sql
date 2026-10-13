CREATE OR REPLACE FUNCTION public.education_hour_window(_subtype text, _on date)
RETURNS TABLE (start_on date, end_on date)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN _subtype = 'regular' AND EXTRACT(MONTH FROM _on) <= 6
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 1, 1)
      WHEN _subtype = 'regular'
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 7, 1)
      WHEN _subtype = 'manager'
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 1, 1)
      ELSE NULL
    END,
    CASE
      WHEN _subtype = 'regular' AND EXTRACT(MONTH FROM _on) <= 6
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 6, 30)
      WHEN _subtype = 'regular'
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 12, 31)
      WHEN _subtype = 'manager'
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 12, 31)
      ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.education_period_hours(_worker_id uuid, _subtype text, _on date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.hours), 0)
  FROM public.worker_education_records r
  CROSS JOIN public.education_hour_window(_subtype, COALESCE(_on, CURRENT_DATE)) w
  WHERE r.worker_id = _worker_id
    AND COALESCE(r.is_deleted, false) = false
    AND public.education_record_requirement_subtype(r.education_type) = _subtype
    AND (
      w.start_on IS NULL
      OR (r.completed_at >= w.start_on AND r.completed_at <= w.end_on)
    );
$$;

CREATE OR REPLACE FUNCTION public.education_required_hours(_worker_id uuid, _subtype text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.required_hours
  FROM public.workers w
  JOIN public.worker_legal_education_mapping m
    ON m.education_type = _subtype
   AND COALESCE(m.is_deleted, false) = false
   AND (
     m.job_type = public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general'))
     OR m.job_type = 'all'
   )
   AND (m.is_system_default = true OR m.project_id = w.project_id)
  WHERE w.id = _worker_id
  ORDER BY (m.project_id IS NOT NULL) DESC, m.updated_at DESC NULLS LAST
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.education_hours_met(_worker_id uuid, _subtype text, _on date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _need numeric;
  _have numeric;
BEGIN
  IF _worker_id IS NULL OR _subtype IS NULL THEN
    RETURN false;
  END IF;
  IF _subtype = 'new_hire' AND EXISTS (
    SELECT 1 FROM public.worker_education_records r
    WHERE r.worker_id = _worker_id
      AND COALESCE(r.is_deleted, false) = false
      AND public.education_record_requirement_subtype(r.education_type) = 'new_hire_construction'
  ) THEN
    RETURN true;
  END IF;
  _need := public.education_required_hours(_worker_id, _subtype);
  IF _need IS NULL THEN
    RETURN false;
  END IF;
  _have := public.education_period_hours(_worker_id, _subtype, COALESCE(_on, CURRENT_DATE));
  RETURN _have >= _need;
END;
$$;

REVOKE ALL ON FUNCTION public.education_hour_window(text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.education_period_hours(uuid, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.education_required_hours(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.education_hours_met(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.education_hours_met(uuid, text, date) TO service_role;
