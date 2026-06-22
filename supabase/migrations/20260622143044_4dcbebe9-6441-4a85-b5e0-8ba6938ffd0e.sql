
CREATE OR REPLACE FUNCTION public.get_worker_today_content(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _w record;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  _runs jsonb;
  _hazards jsonb;
  _materials jsonb;
BEGIN
  SELECT id, project_id, company_id, name
    INTO _w
    FROM public.workers
   WHERE qr_token = _token AND is_active = true
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  -- 오늘 유효한 회사대상 위험성평가 runs (승인완료 + 기간 내)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ar.id,
           'title', ar.title,
           'period_label', ar.period_label,
           'start_date', ar.start_date,
           'end_date', ar.end_date
         ) ORDER BY ar.updated_at DESC), '[]'::jsonb)
    INTO _runs
    FROM public.assessment_runs ar
   WHERE ar.project_id = _w.project_id
     AND COALESCE(ar.is_deleted,false) = false
     AND ar.status = '승인완료'
     AND (_w.company_id IS NULL OR _w.company_id = ANY(COALESCE(ar.target_company_ids, ARRAY[]::uuid[])))
     AND (ar.start_date IS NULL OR ar.start_date <= _today)
     AND (ar.end_date IS NULL OR ar.end_date >= _today);

  -- 해당 runs의 상/중 등급 위험요인 Top
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO _hazards
  FROM (
    SELECT ri.id, ri.process, ri.sub_task, ri.hazard, ri.hazard_situation,
           ri.improvement_measure, ri.risk_score,
           CASE WHEN ri.risk_score >= 6 THEN '상'
                WHEN ri.risk_score >= 3 THEN '중'
                ELSE '하' END AS risk_level
      FROM public.risk_items ri
     WHERE COALESCE(ri.is_deleted,false) = false
       AND ri.project_id = _w.project_id
       AND ri.run_id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(_runs) e)
       AND COALESCE(ri.risk_score,0) >= 3
     ORDER BY ri.risk_score DESC NULLS LAST, ri.updated_at DESC
     LIMIT 10
  ) x;

  -- 오늘 기준 최근 7일 이내 작성된 회사대상 교육자료
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'title', m.title,
           'work_overview', m.work_overview,
           'key_hazards', m.key_hazards,
           'created_at', m.created_at
         ) ORDER BY m.created_at DESC), '[]'::jsonb)
    INTO _materials
    FROM public.safety_education_materials m
   WHERE m.project_id = _w.project_id
     AND COALESCE(m.is_deleted,false) = false
     AND (m.company_id IS NULL OR _w.company_id IS NULL OR m.company_id = _w.company_id)
     AND m.created_at >= (_today - INTERVAL '7 days');

  RETURN jsonb_build_object(
    'success', true,
    'worker_name', _w.name,
    'work_date', _today,
    'company_id', _w.company_id,
    'runs', _runs,
    'hazards', _hazards,
    'materials', _materials
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_worker_today_content(text) TO anon, authenticated;
