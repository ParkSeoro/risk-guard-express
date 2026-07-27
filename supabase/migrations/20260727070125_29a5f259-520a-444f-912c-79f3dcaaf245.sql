-- 전자결재 위계 자동 정렬 방어벽 (서버 사이드 SSOT)
-- 프론트에서 우회/변조된 결재선이 들어와도, 협력사 → 시공사(GC) → 발주처(Client) → 협조 순으로 강제 정렬한다.
-- 알 수 없는 position 키는 상신 자체를 거부한다.

CREATE OR REPLACE FUNCTION public.submit_approval(
  _entity_type text,
  _entity_id uuid,
  _project_id uuid,
  _company_id uuid,
  _steps jsonb,
  _reason text DEFAULT NULL::text
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_next_version integer;
  v_step jsonb;
  v_order integer := 1;
  v_inserted integer := 0;
  v_bad_pos text;
  v_sorted jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

  -- (1) SSOT 직책 키 검증: 알 수 없는 position 은 상신 차단
  SELECT lower(s->>'position') INTO v_bad_pos
    FROM jsonb_array_elements(_steps) s
   WHERE lower(COALESCE(s->>'position','')) NOT IN (
     'contractor_supervisor','contractor_safety_manager','contractor_site_director',
     'gc','gc_manager','gc_pm',
     'owner_cm','owner_sm',
     'cooperator'
   )
   LIMIT 1;
  IF v_bad_pos IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_approval_position: %', v_bad_pos;
  END IF;

  -- (2) 위계 강제 정렬: 협력사(10~12) → 시공사(20~22) → 발주처(30~31) → 협조(40)
  --     동일 랭크 내에서는 입력 순서(ordinality) 유지 → owner_sm 은 무조건 마지막.
  SELECT COALESCE(jsonb_agg(step ORDER BY rnk, ord), '[]'::jsonb)
    INTO v_sorted
    FROM (
      SELECT t.step,
             t.ord,
             CASE lower(t.step->>'position')
               WHEN 'contractor_supervisor'      THEN 10
               WHEN 'contractor_safety_manager'  THEN 11
               WHEN 'contractor_site_director'   THEN 12
               WHEN 'gc'                         THEN 20
               WHEN 'gc_manager'                 THEN 21
               WHEN 'gc_pm'                      THEN 22
               WHEN 'owner_cm'                   THEN 30
               WHEN 'owner_sm'                   THEN 31
               WHEN 'cooperator'                 THEN 40
               ELSE 99
             END AS rnk
        FROM jsonb_array_elements(_steps) WITH ORDINALITY AS t(step, ord)
    ) ranked;

  -- 재상신 시 이전 미결 결재는 취소 처리
  UPDATE public.approvals
     SET status='취소',
         comment=COALESCE(comment,'') || CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] ' || _reason ELSE '' END,
         updated_at=now()
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND status IN ('대기','진행중');

  SELECT COALESCE(MAX(approval_version),0)+1 INTO v_next_version
    FROM public.approvals WHERE entity_type=_entity_type AND entity_id=_entity_id;

  -- (3) 위계 정렬된 순서로 삽입. 1단계만 '진행중', 나머지는 '대기'(Sequential Lock 유지).
  FOR v_step IN SELECT * FROM jsonb_array_elements(v_sorted) LOOP
    INSERT INTO public.approvals(
      project_id, entity_type, entity_id, run_id, step, step_order, status, approval_version,
      approver_id, approver_name, position, company_id, company_name
    ) VALUES (
      _project_id, _entity_type, _entity_id,
      CASE WHEN _entity_type='assessment_run' THEN _entity_id ELSE NULL END,
      COALESCE(v_step->>'label','결재'), v_order,
      CASE WHEN v_order=1 THEN '진행중' ELSE '대기' END,
      v_next_version,
      NULLIF(v_step->>'user_id','')::uuid,
      COALESCE(v_step->>'user_name',''),
      COALESCE(v_step->>'position',''),
      NULLIF(v_step->>'company_id','')::uuid,
      COALESCE(v_step->>'company_name','')
    );
    v_order := v_order + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  IF _entity_type='assessment_run' THEN
    BEGIN
      UPDATE public.assessment_runs SET status='결재진행', updated_at=now()
       WHERE id=_entity_id AND status NOT IN ('승인완료');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN v_inserted;
END; $function$;