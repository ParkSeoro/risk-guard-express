
-- Track 3: Unified approval engine (retry with correct columns).

CREATE OR REPLACE FUNCTION public.submit_approval(
  _entity_type text, _entity_id uuid, _project_id uuid, _company_id uuid,
  _steps jsonb, _reason text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_next_version integer;
  v_step jsonb;
  v_order integer := 1;
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

  UPDATE public.approvals
     SET status = '취소',
         comment = COALESCE(comment,'') ||
                   CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] '||_reason ELSE '' END,
         updated_at = now()
   WHERE entity_type = _entity_type AND entity_id = _entity_id
     AND status IN ('대기','진행중');

  SELECT COALESCE(MAX(approval_version),0)+1 INTO v_next_version
    FROM public.approvals WHERE entity_type=_entity_type AND entity_id=_entity_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(_steps)
  LOOP
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
    v_order := v_order + 1; v_inserted := v_inserted + 1;
  END LOOP;

  IF _entity_type = 'assessment_run' THEN
    BEGIN
      UPDATE public.assessment_runs SET status='pending_approval', updated_at=now()
       WHERE id=_entity_id AND status <> 'approved';
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, project_id, related_entity_type, related_entity_id)
  SELECT a.approver_id, 'approval_request', '결재 요청',
         '['||_entity_type||'] 결재가 상신되었습니다.', _project_id, _entity_type, _entity_id
    FROM public.approvals a
   WHERE a.entity_type=_entity_type AND a.entity_id=_entity_id
     AND a.approval_version=v_next_version AND a.step_order=1 AND a.approver_id IS NOT NULL;

  RETURN v_inserted;
END; $$;
REVOKE EXECUTE ON FUNCTION public.submit_approval(text,uuid,uuid,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_approval(text,uuid,uuid,uuid,jsonb,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.act_on_entity_approval(
  _approval_id uuid, _action text, _comment text DEFAULT ''::text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _a record; _next record; _now timestamptz := now();
  _all_done boolean; _creator uuid;
  _entity_label text; _entity_link text;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_PENDING'); END IF;
  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error','NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;

  _entity_label := CASE _a.entity_type
    WHEN 'work_plan' THEN '작업계획서' WHEN 'work_permit' THEN '작업허가서'
    WHEN 'assessment_run' THEN '위험성평가' WHEN 'safety_cost' THEN '산업안전보건관리비'
    WHEN 'incident' THEN '사고보고' WHEN 'emergency_drill' THEN '비상대피훈련'
    WHEN 'tbm' THEN 'TBM 일지' ELSE _a.entity_type END;
  _entity_link := CASE _a.entity_type
    WHEN 'work_plan' THEN '/work-plans' WHEN 'work_permit' THEN '/work-permits'
    WHEN 'assessment_run' THEN '/assessment-run/'||COALESCE(_a.entity_id::text,'')
    WHEN 'safety_cost' THEN '/safety-cost' WHEN 'incident' THEN '/incidents'
    WHEN 'emergency_drill' THEN '/emergency-drills' WHEN 'tbm' THEN '/tbm-logs'
    ELSE '/approvals' END;

  UPDATE public.approvals
     SET status = CASE WHEN _action='approve' THEN '승인' ELSE '반려' END,
         comment = COALESCE(_comment,''), approved_at=_now, updated_at=_now
   WHERE id=_approval_id;

  IF _action='reject' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version AND status IN ('대기','진행중');

    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='반려', updated_at=_now WHERE id=_a.entity_id
        RETURNING created_by INTO _creator;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='반려', rejection_reason=COALESCE(_comment,''), updated_at=_now
       WHERE id=_a.entity_id RETURNING created_by INTO _creator;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='rejected', updated_at=_now
         WHERE id=_a.entity_id RETURNING created_by INTO _creator;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    IF _creator IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (_creator, 'approval_result', _entity_label||' 반려',
              COALESCE(_comment,'결재가 반려되었습니다.'), _entity_link);
    END IF;
    RETURN jsonb_build_object('success', true, 'action','rejected');
  END IF;

  SELECT * INTO _next FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version AND status='대기' AND step_order>_a.step_order
   ORDER BY step_order ASC LIMIT 1;

  IF FOUND THEN
    UPDATE public.approvals SET status='진행중', updated_at=_now WHERE id=_next.id;
    IF _next.approver_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (_next.approver_id, 'approval_request', _entity_label||' 결재 요청',
              '결재가 필요합니다.', _entity_link);
    END IF;
    RETURN jsonb_build_object('success', true, 'action','forwarded');
  END IF;

  SELECT bool_and(status='승인') INTO _all_done FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version;

  IF _all_done THEN
    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='승인', updated_at=_now WHERE id=_a.entity_id
        RETURNING created_by INTO _creator;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='승인', approved_at=_now, approved_by=auth.uid(),
             updated_at=_now WHERE id=_a.entity_id RETURNING created_by INTO _creator;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='approved', updated_at=_now
         WHERE id=_a.entity_id RETURNING created_by INTO _creator;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF _creator IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (_creator, 'approval_result', _entity_label||' 최종 승인',
              '결재가 완료되었습니다.', _entity_link);
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'action','approved');
END; $$;
REVOKE EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.act_on_approval(
  _approval_id uuid, _action text, _comment text DEFAULT ''::text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public.act_on_entity_approval(_approval_id, _action, _comment); $$;
REVOKE EXECUTE ON FUNCTION public.act_on_approval(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.act_on_approval(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_pending_entity_approvals()
RETURNS TABLE(
  approval_id uuid, entity_type text, entity_id uuid, project_id uuid,
  step text, step_order integer, step_position text,
  created_at timestamp with time zone, entity_title text, entity_date date
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.entity_type, a.entity_id, a.project_id,
         a.step, a.step_order, a.position AS step_position, a.created_at,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.title
           WHEN a.entity_type='work_permit'    THEN per.work_description
           WHEN a.entity_type='assessment_run' THEN ar.period_label
           ELSE '' END AS entity_title,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.start_date
           WHEN a.entity_type='work_permit'    THEN per.permit_date
           WHEN a.entity_type='assessment_run' THEN ar.start_date
           ELSE NULL END AS entity_date
    FROM public.approvals a
    LEFT JOIN public.work_plans      wp  ON a.entity_type='work_plan'      AND wp.id  = a.entity_id
    LEFT JOIN public.work_permits    per ON a.entity_type='work_permit'    AND per.id = a.entity_id
    LEFT JOIN public.assessment_runs ar  ON a.entity_type='assessment_run' AND ar.id  = a.entity_id
   WHERE a.status='진행중' AND a.entity_type IS NOT NULL
     AND (a.approver_id = auth.uid()
          OR (a.approver_id IS NULL AND public.is_project_admin(auth.uid(), a.project_id)))
   ORDER BY a.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() TO authenticated, service_role;
