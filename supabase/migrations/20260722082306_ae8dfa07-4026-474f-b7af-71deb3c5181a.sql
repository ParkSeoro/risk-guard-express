CREATE OR REPLACE FUNCTION public.submit_approval(_entity_type text, _entity_id uuid, _project_id uuid, _company_id uuid, _steps jsonb, _reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_next_version integer; v_step jsonb;
  v_order integer := 1; v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

  UPDATE public.approvals
     SET status='취소',
         comment=COALESCE(comment,'')||CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] '||_reason ELSE '' END,
         updated_at=now()
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND status IN ('대기','진행중');

  SELECT COALESCE(MAX(approval_version),0)+1 INTO v_next_version
    FROM public.approvals WHERE entity_type=_entity_type AND entity_id=_entity_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(_steps) LOOP
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
    v_order := v_order+1; v_inserted := v_inserted+1;
  END LOOP;

  IF _entity_type='assessment_run' THEN
    BEGIN UPDATE public.assessment_runs SET status='결재진행', updated_at=now()
           WHERE id=_entity_id AND status NOT IN ('승인완료'); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, project_id, related_type, related_id)
  SELECT a.approver_id, 'approval_request', '결재 요청',
         '['||_entity_type||'] 결재가 상신되었습니다.', _project_id, _entity_type, _entity_id
    FROM public.approvals a
   WHERE a.entity_type=_entity_type AND a.entity_id=_entity_id
     AND a.approval_version=v_next_version AND a.step_order=1 AND a.approver_id IS NOT NULL;

  RETURN v_inserted;
END; $function$;