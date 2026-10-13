CREATE OR REPLACE FUNCTION public.education_obligation_digest(_today date DEFAULT NULL)
RETURNS TABLE (project_id uuid, kind text, headcount int, message text, link text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _day date := COALESCE(_today, (now() AT TIME ZONE 'Asia/Seoul')::date);
  _half_end date;
BEGIN
  _half_end := (SELECT end_on FROM public.education_hour_window('regular', _day));
  IF (_half_end - _day) <= 30 THEN
    RETURN QUERY
    SELECT w.project_id, 'regular'::text, COUNT(*)::int,
           format('이번 반기 정기교육 미달 %s명', COUNT(*)),
           '/app/admin/worker-education'::text
    FROM public.workers w
    WHERE COALESCE(w.is_active, true) = true
      AND public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general')) IN ('office', 'construction_perm')
      AND NOT public.education_hours_met(w.id, 'regular', _day)
    GROUP BY w.project_id
    HAVING COUNT(*) > 0;
  END IF;

  RETURN QUERY
  SELECT a.project_id, 'certificate'::text, COUNT(DISTINCT a.worker_id)::int,
         format('이수증 없는 오늘 출근 %s명', COUNT(DISTINCT a.worker_id)),
         '/app/admin/worker-education?focus=certificate'::text
  FROM public.v_worker_attendance_today a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.attended = true
    AND a.work_date = _day
    AND public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general'))
        NOT IN ('office', 'construction_perm', 'manager', 'safety_officer')
    AND NOT EXISTS (
      SELECT 1 FROM public.worker_education_records r
      WHERE r.worker_id = w.id
        AND COALESCE(r.is_deleted, false) = false
        AND public.education_record_requirement_subtype(r.education_type) = 'new_hire_construction'
    )
  GROUP BY a.project_id
  HAVING COUNT(DISTINCT a.worker_id) > 0;

  RETURN QUERY
  SELECT i.project_id, 'checkup'::text, COUNT(DISTINCT i.worker_id)::int,
         format('검진 기한 임박 %s명', COUNT(DISTINCT i.worker_id)),
         '/app/admin/health/checkups'::text
  FROM public.worker_required_items i
  WHERE i.item_type = 'checkup'
    AND i.status = 'pending'
    AND COALESCE(i.is_deleted, false) = false
    AND i.due_date IS NOT NULL
    AND i.due_date >= _day
    AND i.due_date <= _day + 7
  GROUP BY i.project_id
  HAVING COUNT(DISTINCT i.worker_id) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.education_obligation_digest(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.education_obligation_digest(date) TO service_role;
