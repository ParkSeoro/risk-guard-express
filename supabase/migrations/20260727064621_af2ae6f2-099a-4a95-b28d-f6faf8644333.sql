-- 중복/오작동 트리거 제거: 대기 상태 INSERT마다 모든 후속 결재자에게 알림을 보내던 문제 해결
DROP TRIGGER IF EXISTS trg_approval_notify_approver ON public.approvals;

-- SSOT 트리거는 trg_approvals_notify_ins/upd (public.trg_approval_notify) 유지.
-- 해당 함수는 이미 status='진행중' 인서트/업데이트에만 알림을 발송하므로,
-- submit_approval이 1단계만 '진행중'으로 넣고 나머지를 '대기'로 넣는 규칙과 결합해
-- 오직 현재 활성 순번 담당자에게만 알림이 도착함.

-- 방어적 재정의: submit_approval - 1단계=진행중, 그 외=대기(잠금) 명시적 문서화 및 보장
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

  -- 재상신 시 이전 미결 결재는 취소 처리
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
      -- 순차 결재 강제: 오직 1단계만 활성(진행중), 이후 단계는 잠금(대기)
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

  RETURN v_inserted;
END; $function$;

-- 방어적 재정의: act_on_entity_approval - 순차 강제 및 다음 단계 자동 활성화
CREATE OR REPLACE FUNCTION public.act_on_entity_approval(_approval_id uuid, _action text, _comment text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _a record; _next record; _prior_pending integer; _now timestamptz := now();
  _all_done boolean; _plan_id uuid;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  -- 순차 결재 강제: 오직 현재 활성(진행중) 단계만 처리 가능
  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_ACTIVE_STEP'); END IF;

  -- 앞선 단계가 아직 미승인이면 절대 처리 불가 (이중 방어)
  SELECT COUNT(*) INTO _prior_pending FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version
     AND step_order < _a.step_order
     AND status NOT IN ('승인');
  IF _prior_pending > 0 THEN
    RETURN jsonb_build_object('error','PRIOR_STEP_NOT_APPROVED');
  END IF;

  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error','NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;

  UPDATE public.approvals
     SET status = CASE WHEN _action='approve' THEN '승인' ELSE '반려' END,
         comment = COALESCE(_comment,''), approved_at=_now, updated_at=_now
   WHERE id=_approval_id;

  IF _action='reject' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version AND status IN ('대기','진행중');

    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='반려', updated_at=_now WHERE id=_a.entity_id;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='반려', rejection_reason=COALESCE(_comment,''), updated_at=_now
       WHERE id=_a.entity_id;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN UPDATE public.assessment_runs SET status='rejected', updated_at=_now
             WHERE id=_a.entity_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','rejected');
  END IF;

  -- 승인: 다음 단계(대기 상태 중 최소 step_order)를 진행중으로 자동 승격
  SELECT * INTO _next FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version AND status='대기' AND step_order>_a.step_order
   ORDER BY step_order ASC LIMIT 1;

  IF FOUND THEN
    -- 다음 담당자 활성화 → SSOT 트리거가 알림/푸시 자동 발송
    UPDATE public.approvals SET status='진행중', updated_at=_now WHERE id=_next.id;
    RETURN jsonb_build_object('success', true, 'action','forwarded', 'next_step_order', _next.step_order);
  END IF;

  -- 모든 단계 승인 완료 여부 확인
  SELECT bool_and(status='승인') INTO _all_done FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version;

  IF _all_done THEN
    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='승인', updated_at=_now WHERE id=_a.entity_id
        RETURNING id INTO _plan_id;
      IF _plan_id IS NOT NULL THEN
        UPDATE public.work_permits
           SET status = CASE WHEN status IN ('승인','반려') THEN status ELSE '승인' END,
               approved_at = COALESCE(approved_at, _now),
               updated_at = _now
         WHERE work_plan_id = _plan_id
           AND COALESCE(status,'') NOT IN ('승인','반려');
      END IF;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='승인', approved_at=_now, approved_by=auth.uid(),
             updated_at=_now WHERE id=_a.entity_id;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN UPDATE public.assessment_runs SET status='approved', updated_at=_now
             WHERE id=_a.entity_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'action','approved');
END; $function$;