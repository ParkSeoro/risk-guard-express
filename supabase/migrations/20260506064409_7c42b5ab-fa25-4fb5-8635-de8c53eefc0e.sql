CREATE OR REPLACE FUNCTION public.get_tbm_by_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _matched_run_id uuid := NULL;
  _matched_run_period_label text := NULL;
  _matched_run_status text := NULL;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT id, project_id, company_id, company_name, process_category, run_id,
         title, briefing_summary, briefing_risks, tbm_date, location, leader_name, is_active
  INTO _s
  FROM public.tbm_sessions
  WHERE qr_token = _token AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  IF _s.run_id IS NOT NULL THEN
    SELECT ar.id, ar.period_label, ar.status
    INTO _matched_run_id, _matched_run_period_label, _matched_run_status
    FROM public.assessment_runs ar
    WHERE ar.id = _s.run_id
      AND COALESCE(ar.is_deleted, false) = false
    LIMIT 1;
  END IF;

  IF _matched_run_id IS NULL AND _s.company_id IS NOT NULL THEN
    SELECT ar.id, ar.period_label, ar.status
    INTO _matched_run_id, _matched_run_period_label, _matched_run_status
    FROM public.assessment_runs ar
    WHERE ar.project_id = _s.project_id
      AND COALESCE(ar.is_deleted, false) = false
      AND ar.status = '승인완료'
      AND _s.company_id = ANY(COALESCE(ar.target_company_ids, ARRAY[]::uuid[]))
      AND (ar.start_date IS NULL OR ar.start_date <= _today)
      AND (ar.end_date IS NULL OR ar.end_date >= _today)
    ORDER BY ar.updated_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'id', _s.id,
    'title', _s.title,
    'briefing_summary', COALESCE(_s.briefing_summary, ''),
    'briefing_risks', COALESCE(_s.briefing_risks, '[]'::jsonb),
    'tbm_date', _s.tbm_date,
    'location', COALESCE(_s.location, ''),
    'leader_name', COALESCE(_s.leader_name, ''),
    'company_id', _s.company_id,
    'company_name', COALESCE(_s.company_name, ''),
    'process_category', COALESCE(_s.process_category, ''),
    'matched_run', CASE WHEN _matched_run_id IS NOT NULL
      THEN jsonb_build_object('id', _matched_run_id, 'period_label', _matched_run_period_label, 'status', _matched_run_status)
      ELSE NULL END
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tbm_by_token(text) TO anon, authenticated;