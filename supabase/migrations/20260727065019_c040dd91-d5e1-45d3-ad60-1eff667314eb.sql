-- 결재 회수(Withdraw) RPC: 상신자가 아직 진행 중인 결재를 회수할 수 있음
-- 규칙:
--   1) 최신 approval_version 의 결재만 대상
--   2) 그 버전에서 '승인' 또는 '반려' 된 단계가 하나라도 있으면 회수 불가
--   3) 회수자는 해당 엔터티(work_plan/work_permit/assessment_run)의 작성자여야 함
--      (assessment_run 은 created_by, work_plan/work_permit 은 created_by 컬럼 사용;
--       컬럼이 없을 경우 project_admin/master 만 허용)
--   4) 진행중/대기 단계 전부 '취소' 처리, 코멘트에 [회수] 사유 기록
--   5) 부모 엔터티 status 는 '작성중' 등 초안 상태로 되돌림

CREATE OR REPLACE FUNCTION public.withdraw_approval(
  _entity_type text,
  _entity_id   uuid,
  _reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version integer;
  v_project uuid;
  v_creator uuid;
  v_has_decided boolean;
  v_now timestamptz := now();
  v_affected integer;
  v_is_admin boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','UNAUTHENTICATED'); END IF;
  IF _entity_type NOT IN ('work_plan','work_permit','assessment_run') THEN
    RETURN jsonb_build_object('error','INVALID_ENTITY_TYPE');
  END IF;

  -- 최신 approval_version 조회
  SELECT MAX(approval_version), MAX(project_id)
    INTO v_version, v_project
    FROM public.approvals
   WHERE entity_type=_entity_type AND entity_id=_entity_id;

  IF v_version IS NULL THEN
    RETURN jsonb_build_object('error','NO_APPROVAL');
  END IF;

  -- 승인/반려 단계가 존재하면 회수 불가
  SELECT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type=_entity_type AND entity_id=_entity_id
       AND approval_version=v_version
       AND status IN ('승인','반려')
  ) INTO v_has_decided;
  IF v_has_decided THEN
    RETURN jsonb_build_object('error','ALREADY_DECIDED');
  END IF;

  -- 작성자 확인
  IF _entity_type='work_plan' THEN
    SELECT created_by INTO v_creator FROM public.work_plans WHERE id=_entity_id;
  ELSIF _entity_type='work_permit' THEN
    SELECT created_by INTO v_creator FROM public.work_permits WHERE id=_entity_id;
  ELSIF _entity_type='assessment_run' THEN
    SELECT created_by INTO v_creator FROM public.assessment_runs WHERE id=_entity_id;
  END IF;

  -- Master/Project Admin 은 대리 회수 허용
  SELECT public.is_master(v_uid)
      OR EXISTS (SELECT 1 FROM public.project_members
                  WHERE project_id=v_project AND user_id=v_uid
                    AND role IN ('project_admin','safety_manager'))
    INTO v_is_admin;

  IF v_creator IS DISTINCT FROM v_uid AND NOT v_is_admin THEN
    RETURN jsonb_build_object('error','NOT_SUBMITTER');
  END IF;

  -- 진행중/대기 단계 전체 취소
  UPDATE public.approvals
     SET status='취소',
         comment=COALESCE(comment,'') ||
           CASE WHEN _reason IS NOT NULL AND _reason<>''
                THEN E'\n[회수] ' || _reason
                ELSE E'\n[회수] 상신자에 의해 회수됨' END,
         updated_at=v_now
   WHERE entity_type=_entity_type AND entity_id=_entity_id
     AND approval_version=v_version
     AND status IN ('진행중','대기');

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  -- 부모 엔터티 상태 되돌림
  IF _entity_type='work_plan' THEN
    UPDATE public.work_plans SET status='작성중', updated_at=v_now WHERE id=_entity_id;
  ELSIF _entity_type='work_permit' THEN
    UPDATE public.work_permits SET status='작성중', updated_at=v_now WHERE id=_entity_id;
  ELSIF _entity_type='assessment_run' THEN
    BEGIN
      UPDATE public.assessment_runs SET status='draft', updated_at=v_now WHERE id=_entity_id;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('success', true, 'withdrawn_steps', v_affected, 'version', v_version);
END; $function$;

REVOKE EXECUTE ON FUNCTION public.withdraw_approval(text, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.withdraw_approval(text, uuid, text) TO authenticated, service_role;