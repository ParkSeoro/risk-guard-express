ALTER TABLE public.tbm_sessions
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS company_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS process_category text DEFAULT '';

CREATE OR REPLACE FUNCTION public.get_tbm_by_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _matched_run record;
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

  -- 동일 회사 + 해당 날짜 포함 + 승인완료 위험성평가 우선 매칭
  IF _s.run_id IS NOT NULL THEN
    SELECT id, period_label, status INTO _matched_run
    FROM public.assessment_runs
    WHERE id = _s.run_id AND is_deleted = false;
  END IF;

  IF _matched_run.id IS NULL AND _s.company_id IS NOT NULL THEN
    SELECT ar.id, ar.period_label, ar.status INTO _matched_run
    FROM public.assessment_runs ar
    WHERE ar.project_id = _s.project_id
      AND ar.is_deleted = false
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
    'briefing_summary', _s.briefing_summary,
    'briefing_risks', _s.briefing_risks,
    'tbm_date', _s.tbm_date,
    'location', _s.location,
    'leader_name', _s.leader_name,
    'company_id', _s.company_id,
    'company_name', _s.company_name,
    'process_category', _s.process_category,
    'matched_run', CASE WHEN _matched_run.id IS NOT NULL
      THEN jsonb_build_object('id', _matched_run.id, 'period_label', _matched_run.period_label, 'status', _matched_run.status)
      ELSE NULL END
  );
END;
$function$;