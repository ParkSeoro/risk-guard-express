-- Fix: withdraw_approval used MAX(project_id) but project_id is uuid
-- → "function max(uuid) does not exist"
-- Also: role → role_new; heal assessment_run stuck in 결재진행 after 반려.

CREATE OR REPLACE FUNCTION public.withdraw_approval(
  _entity_type text,
  _entity_id   uuid,
  _reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version integer;
  v_project uuid;
  v_creator uuid;
  v_has_decided boolean;
  v_has_reject boolean;
  v_now timestamptz := now();
  v_affected integer;
  v_is_admin boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','UNAUTHENTICATED'); END IF;
  IF _entity_type NOT IN ('work_plan','work_permit','assessment_run') THEN
    RETURN jsonb_build_object('error','INVALID_ENTITY_TYPE');
  END IF;

  -- uuid에는 MAX() 불가 — 최신 version 행에서 project_id를 함께 읽는다
  SELECT a.approval_version, a.project_id
    INTO v_version, v_project
    FROM public.approvals a
   WHERE a.entity_type = _entity_type
     AND a.entity_id = _entity_id
   ORDER BY a.approval_version DESC NULLS LAST, a.created_at DESC NULLS LAST
   LIMIT 1;

  IF v_version IS NULL THEN
    RETURN jsonb_build_object('error','NO_APPROVAL');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type = _entity_type AND entity_id = _entity_id
       AND approval_version = v_version
       AND status = '반려'
  ) INTO v_has_reject;

  -- 이미 반려된 문서: 회수 대신 문서 상태를 반려로 보정하고 안내
  IF v_has_reject THEN
    IF _entity_type = 'work_plan' THEN
      UPDATE public.work_plans SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    ELSIF _entity_type = 'work_permit' THEN
      PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
      UPDATE public.work_permits SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    ELSIF _entity_type = 'assessment_run' THEN
      UPDATE public.assessment_runs SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    END IF;
    RETURN jsonb_build_object(
      'error', 'ALREADY_REJECTED',
      'healed', true,
      'message', '이미 반려된 결재입니다. 문서를 수정한 뒤 재상신하세요.'
    );
  END IF;

  -- 상신 자동승인은 회수 허용; 그 외 승인이 있으면 차단
  SELECT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type = _entity_type AND entity_id = _entity_id
       AND approval_version = v_version
       AND status = '승인'
       AND lower(COALESCE(position, '')) NOT IN (
         'contractor_supervisor', 'contractor_pic', 'site_supervisor'
       )
  ) INTO v_has_decided;
  IF v_has_decided THEN
    RETURN jsonb_build_object('error','ALREADY_DECIDED');
  END IF;

  IF _entity_type = 'work_plan' THEN
    SELECT created_by INTO v_creator FROM public.work_plans WHERE id = _entity_id;
  ELSIF _entity_type = 'work_permit' THEN
    SELECT created_by INTO v_creator FROM public.work_permits WHERE id = _entity_id;
  ELSIF _entity_type = 'assessment_run' THEN
    SELECT created_by INTO v_creator FROM public.assessment_runs WHERE id = _entity_id;
  END IF;

  SELECT public.is_master(v_uid)
      OR public.has_project_role(
           v_uid,
           v_project,
           ARRAY['project_admin', 'safety_manager', 'site_manager', 'site_supervisor']::public.project_role[]
         )
    INTO v_is_admin;

  IF v_creator IS DISTINCT FROM v_uid AND NOT v_is_admin THEN
    RETURN jsonb_build_object('error','NOT_SUBMITTER');
  END IF;

  UPDATE public.approvals
     SET status = '취소',
         comment = COALESCE(comment, '') ||
           CASE WHEN _reason IS NOT NULL AND _reason <> ''
                THEN E'\n[회수] ' || _reason
                ELSE E'\n[회수] 상신자에 의해 회수됨' END,
         updated_at = v_now
   WHERE entity_type = _entity_type
     AND entity_id = _entity_id
     AND approval_version = v_version
     AND status IN ('진행중', '대기', '승인');

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF _entity_type = 'work_plan' THEN
    UPDATE public.work_plans SET status = '작성중', updated_at = v_now WHERE id = _entity_id;
  ELSIF _entity_type = 'work_permit' THEN
    PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
    UPDATE public.work_permits SET status = '작성중', updated_at = v_now WHERE id = _entity_id;
  ELSIF _entity_type = 'assessment_run' THEN
    UPDATE public.assessment_runs SET status = '검증완료', updated_at = v_now WHERE id = _entity_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'withdrawn_steps', v_affected, 'version', v_version);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.withdraw_approval(text, uuid, text) TO authenticated, service_role;
