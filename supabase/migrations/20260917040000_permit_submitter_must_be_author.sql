-- 허가서도 담당자(시공)=상신자만. 시공 칸이 1단계가 아니어도 자동 완료.
-- 막힌 상신칸(시공≠작성자 + 이미 다른 단계 승인)은 작성자가 회수할 수 있게 함.

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
  v_created uuid;
  v_has_decided boolean;
  v_has_reject boolean;
  v_stuck_submitter boolean;
  v_now timestamptz := now();
  v_affected integer;
  v_is_admin boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','UNAUTHENTICATED'); END IF;
  IF _entity_type NOT IN ('work_plan','work_permit','assessment_run','safety_inspection') THEN
    RETURN jsonb_build_object('error','INVALID_ENTITY_TYPE');
  END IF;

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

  IF _entity_type = 'work_plan' THEN
    SELECT created_by INTO v_creator FROM public.work_plans WHERE id = _entity_id;
    v_created := v_creator;
  ELSIF _entity_type = 'work_permit' THEN
    SELECT created_by INTO v_creator FROM public.work_permits WHERE id = _entity_id;
    v_created := v_creator;
  ELSIF _entity_type = 'assessment_run' THEN
    SELECT author_user_id, created_by INTO v_creator, v_created
      FROM public.assessment_runs WHERE id = _entity_id;
    IF v_creator IS NULL THEN v_creator := v_created; END IF;
  ELSIF _entity_type = 'safety_inspection' THEN
    SELECT COALESCE(created_by, inspector_id) INTO v_creator
      FROM public.safety_inspections WHERE id = _entity_id;
    v_created := v_creator;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type = _entity_type AND entity_id = _entity_id
       AND approval_version = v_version
       AND status = '반려'
  ) INTO v_has_reject;

  IF v_has_reject THEN
    IF _entity_type = 'work_plan' THEN
      UPDATE public.work_plans SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    ELSIF _entity_type = 'work_permit' THEN
      PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
      UPDATE public.work_permits SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    ELSIF _entity_type = 'assessment_run' THEN
      UPDATE public.assessment_runs SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    ELSIF _entity_type = 'safety_inspection' THEN
      PERFORM set_config('app.skip_document_edit_lock', '1', true);
      UPDATE public.safety_inspections SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    END IF;
    RETURN jsonb_build_object(
      'error', 'ALREADY_REJECTED',
      'healed', true,
      'message', '이미 반려된 결재입니다. 문서를 수정한 뒤 재상신하세요.'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type = _entity_type AND entity_id = _entity_id
       AND approval_version = v_version
       AND status = '승인'
       AND lower(COALESCE(position, '')) NOT IN (
         'contractor_supervisor', 'contractor_pic', 'site_supervisor'
       )
  ) INTO v_has_decided;

  SELECT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type = _entity_type AND entity_id = _entity_id
       AND approval_version = v_version
       AND status = '진행중'
       AND lower(COALESCE(position, '')) IN ('contractor_supervisor', 'contractor_pic')
       AND approver_id IS DISTINCT FROM v_uid
       AND approver_id IS DISTINCT FROM v_creator
       AND (v_created IS NULL OR approver_id IS DISTINCT FROM v_created)
  ) INTO v_stuck_submitter;

  IF v_has_decided AND NOT v_stuck_submitter THEN
    RETURN jsonb_build_object('error','ALREADY_DECIDED');
  END IF;

  SELECT public.is_master(v_uid)
      OR public.has_project_role(
           v_uid,
           v_project,
           ARRAY['project_admin', 'safety_manager', 'site_manager', 'site_supervisor']::public.project_role[]
         )
    INTO v_is_admin;

  IF v_uid IS DISTINCT FROM v_creator
     AND v_uid IS DISTINCT FROM v_created
     AND NOT v_is_admin THEN
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
  ELSIF _entity_type = 'safety_inspection' THEN
    PERFORM set_config('app.skip_document_edit_lock', '1', true);
    UPDATE public.safety_inspections
       SET status = 'in_progress',
           updated_at = v_now
     WHERE id = _entity_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'withdrawn_steps', v_affected, 'version', v_version);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.withdraw_approval(text, uuid, text) TO authenticated, service_role;

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
  v_first record;
  v_submitter record;
  v_next record;
  v_pos text;
  v_now timestamptz := now();
  v_seen_keys text[] := ARRAY[]::text[];
  v_dedupe_key text;
  v_author uuid;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

  IF _entity_type = 'safety_cost' THEN
    PERFORM public.assert_safety_cost_ready_to_submit(_entity_id);
  END IF;

  UPDATE public.approvals
     SET status='취소',
         comment=COALESCE(comment,'')||CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] '||_reason ELSE '' END,
         updated_at=v_now
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND status IN ('대기','진행중');

  SELECT COALESCE(MAX(approval_version),0)+1 INTO v_next_version
    FROM public.approvals WHERE entity_type=_entity_type AND entity_id=_entity_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    IF COALESCE(v_step->>'position','') = '' OR NULLIF(v_step->>'user_id','') IS NULL THEN
      CONTINUE;
    END IF;
    v_dedupe_key := lower(COALESCE(v_step->>'position','')) || ':' || (v_step->>'user_id');
    IF v_dedupe_key = ANY(v_seen_keys) THEN
      CONTINUE;
    END IF;
    v_seen_keys := array_append(v_seen_keys, v_dedupe_key);
    v_keys := array_append(v_keys, lower(COALESCE(v_step->>'position','')));

    INSERT INTO public.approvals(
      project_id, entity_type, entity_id, run_id, step, step_order, status, approval_version,
      approver_id, approver_name, position, company_id, company_name
    ) VALUES (
      _project_id, _entity_type, _entity_id,
      CASE WHEN _entity_type='assessment_run' THEN _entity_id ELSE NULL END,
      COALESCE(v_step->>'label','결재'), v_order,
      '대기',
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

  IF v_inserted = 0 THEN RAISE EXCEPTION 'empty_steps_after_dedupe'; END IF;

  IF _entity_type = 'safety_cost' THEN
    IF NOT ('contractor_supervisor' = ANY (v_keys) OR 'contractor_pic' = ANY (v_keys)) THEN
      RAISE EXCEPTION 'safety_cost_requires_author';
    END IF;
    IF NOT ('contractor_site_director' = ANY (v_keys) OR 'site_director' = ANY (v_keys)) THEN
      RAISE EXCEPTION 'safety_cost_requires_site_director';
    END IF;
    IF NOT ('owner_sm' = ANY (v_keys) OR 'sm' = ANY (v_keys)) THEN
      RAISE EXCEPTION 'safety_cost_requires_owner_sm';
    END IF;
  END IF;

  IF _entity_type='assessment_run' THEN
    UPDATE public.assessment_runs
       SET status='결재진행', updated_at=v_now
     WHERE id=_entity_id AND status NOT IN ('승인완료');
  ELSIF _entity_type='work_permit' THEN
    PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
    UPDATE public.work_permits
       SET status='결재중',
           submitted_at=COALESCE(submitted_at, v_now),
           submitted_by=COALESCE(submitted_by, v_uid),
           updated_at=v_now
     WHERE id=_entity_id
       AND COALESCE(status,'') NOT IN ('승인','발행완료');
  ELSIF _entity_type='work_plan' THEN
    UPDATE public.work_plans
       SET status='결재중', updated_at=v_now
     WHERE id=_entity_id
       AND COALESCE(status,'') NOT IN ('승인','승인완료');
  ELSIF _entity_type='safety_cost' THEN
    PERFORM set_config('app.skip_document_edit_lock', '1', true);
    UPDATE public.safety_cost_monthly_reports
       SET status='submitted',
           submitted_by=v_uid,
           submitted_at=v_now
     WHERE id=_entity_id
       AND COALESCE(status,'') IN ('draft', 'rejected');
    PERFORM public.snapshot_approval_document('safety_cost', _entity_id, v_next_version);
  END IF;

  SELECT * INTO v_first
    FROM public.approvals
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND approval_version=v_next_version
   ORDER BY step_order ASC
   LIMIT 1;

  SELECT * INTO v_submitter
    FROM public.approvals
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND approval_version=v_next_version
     AND lower(COALESCE(position, '')) IN ('contractor_supervisor', 'contractor_pic')
   ORDER BY step_order ASC
   LIMIT 1;

  -- FOUND after SELECT INTO v_submitter. Use the record itself so a missing
  -- 시공 칸 still activates v_first (work_plan / safety_cost without that step).
  IF v_submitter.id IS NOT NULL AND _entity_type IN ('assessment_run', 'work_permit') THEN
    IF _entity_type = 'assessment_run' THEN
      SELECT COALESCE(author_user_id, created_by) INTO v_author
        FROM public.assessment_runs WHERE id = _entity_id;
    ELSE
      SELECT created_by INTO v_author FROM public.work_permits WHERE id = _entity_id;
    END IF;
    IF v_submitter.approver_id IS DISTINCT FROM v_uid
       OR (v_author IS NOT NULL AND v_submitter.approver_id IS DISTINCT FROM v_author) THEN
      UPDATE public.approvals
         SET status = '취소',
             comment = COALESCE(comment, '') || E'\n[상신거부] 담당자(시공)는 작성자 본인이어야 합니다.',
             updated_at = v_now
       WHERE entity_type = _entity_type
         AND entity_id = _entity_id
         AND approval_version = v_next_version;
      IF _entity_type = 'assessment_run' THEN
        UPDATE public.assessment_runs
           SET status = '검증완료', updated_at = v_now
         WHERE id = _entity_id AND status = '결재진행';
      ELSE
        PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
        UPDATE public.work_permits
           SET status = '작성중', updated_at = v_now
         WHERE id = _entity_id AND status = '결재중';
      END IF;
      RAISE EXCEPTION 'submitter_step_must_be_author';
    END IF;
  END IF;

  IF v_submitter.id IS NOT NULL
     AND lower(COALESCE(v_submitter.position, '')) IN ('contractor_supervisor', 'contractor_pic')
     AND (v_submitter.approver_id IS NULL OR v_submitter.approver_id = v_uid)
  THEN
    UPDATE public.approvals
       SET status='승인',
           approver_id=COALESCE(approver_id, v_uid),
           approved_at=v_now,
           comment=CASE
             WHEN COALESCE(comment,'') = '' THEN '[상신 완료]'
             ELSE comment
           END,
           updated_at=v_now
     WHERE id=v_submitter.id;

    IF _entity_type='work_permit' THEN
      PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
      UPDATE public.work_permits wp
         SET signatures = COALESCE(wp.signatures, '{}'::jsonb) || jsonb_build_object(
               'contractor_pic', jsonb_build_object(
                 'name', COALESCE(v_submitter.approver_name, ''),
                 'signature', COALESCE(wp.signatures->'contractor_pic'->>'signature', ''),
                 'signed_at', v_now
               )
             ),
             updated_at = v_now
       WHERE wp.id = _entity_id;
    END IF;

    SELECT * INTO v_next
      FROM public.approvals
     WHERE entity_type=_entity_type AND entity_id=_entity_id AND approval_version=v_next_version
       AND status='대기'
     ORDER BY step_order ASC
     LIMIT 1;

    IF v_next.id IS NOT NULL THEN
      UPDATE public.approvals SET status='진행중', updated_at=v_now WHERE id=v_next.id;
    ELSE
      IF _entity_type='work_permit' THEN
        PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
        UPDATE public.work_permits
           SET status='승인', approved_at=v_now, approved_by=v_uid, updated_at=v_now
         WHERE id=_entity_id AND COALESCE(status,'') NOT IN ('종료대기','종료완료');
      ELSIF _entity_type='work_plan' THEN
        UPDATE public.work_plans SET status='승인완료', updated_at=v_now WHERE id=_entity_id;
      ELSIF _entity_type='assessment_run' THEN
        UPDATE public.assessment_runs SET status='승인완료', updated_at=v_now WHERE id=_entity_id;
      ELSIF _entity_type='safety_cost' THEN
        PERFORM set_config('app.skip_document_edit_lock', '1', true);
        UPDATE public.safety_cost_monthly_reports
           SET status='approved', approved_by=v_uid, approved_at=v_now
         WHERE id=_entity_id;
      END IF;
    END IF;
  ELSIF v_first.id IS NOT NULL THEN
    UPDATE public.approvals SET status='진행중', updated_at=v_now WHERE id=v_first.id;
  END IF;

  RETURN v_inserted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_approval(text, uuid, uuid, uuid, jsonb, text) TO authenticated, service_role;
