-- ============================================================
-- Emergency approval overhaul (isolated)
-- 1) Auto-complete 상신(contractor_supervisor) on submit
-- 2) Allow approval RPC to stamp signatures under edit lock
-- 3) Heal stuck self-approval 진행중 steps
-- ============================================================

-- Edit lock: allow SECURITY DEFINER approval RPCs to stamp metadata
CREATE OR REPLACE FUNCTION public.enforce_work_permit_edit_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Approval RPCs set this for one transaction only
  IF current_setting('app.skip_work_permit_edit_lock', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Editable only while drafting or after reject
  IF COALESCE(OLD.status, '') IN ('작성중', '반려') THEN
    RETURN NEW;
  END IF;

  -- Soft-delete / restore always allowed
  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
    RETURN NEW;
  END IF;

  -- Block content mutations; allow status/approval metadata transitions (RPC)
  IF NEW.form_data IS DISTINCT FROM OLD.form_data
     OR NEW.signatures IS DISTINCT FROM OLD.signatures
     OR NEW.work_description IS DISTINCT FROM OLD.work_description
     OR NEW.work_name IS DISTINCT FROM OLD.work_name
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.contractor_company IS DISTINCT FROM OLD.contractor_company
     OR NEW.personnel_count IS DISTINCT FROM OLD.personnel_count
     OR NEW.work_start_at IS DISTINCT FROM OLD.work_start_at
     OR NEW.work_end_at IS DISTINCT FROM OLD.work_end_at
     OR NEW.permit_type IS DISTINCT FROM OLD.permit_type
     OR NEW.permit_date IS DISTINCT FROM OLD.permit_date
     OR NEW.form_template_id IS DISTINCT FROM OLD.form_template_id
     OR NEW.linked_assessment_run_ids IS DISTINCT FROM OLD.linked_assessment_run_ids
     OR NEW.assessment_run_id IS DISTINCT FROM OLD.assessment_run_id
     OR NEW.work_plan_id IS DISTINCT FROM OLD.work_plan_id
     OR NEW.tbm_session_id IS DISTINCT FROM OLD.tbm_session_id
  THEN
    RAISE EXCEPTION 'WORK_PERMIT_LOCKED: 결재 진행중/완료 문서는 수정할 수 없습니다. (status=%)', OLD.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- submit_approval: insert steps, auto-approve 상신 step, activate next
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
  v_next record;
  v_pos text;
  v_now timestamptz := now();
  v_seen_keys text[] := ARRAY[]::text[];
  v_dedupe_key text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

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
    -- Dedupe identical person+position (blocks twin 시공사/협력사 copies of the same node)
    v_dedupe_key := lower(COALESCE(v_step->>'position','')) || ':' || (v_step->>'user_id');
    IF v_dedupe_key = ANY(v_seen_keys) THEN
      CONTINUE;
    END IF;
    v_seen_keys := array_append(v_seen_keys, v_dedupe_key);

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

  -- Parent document → 결재중
  IF _entity_type='assessment_run' THEN
    BEGIN
      UPDATE public.assessment_runs
         SET status='결재진행', updated_at=v_now
       WHERE id=_entity_id AND status NOT IN ('승인완료');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
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
  END IF;

  -- First step: if 상신(contractor_supervisor) by submitter → auto 승인
  SELECT * INTO v_first
    FROM public.approvals
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND approval_version=v_next_version
   ORDER BY step_order ASC
   LIMIT 1;

  IF FOUND THEN
    v_pos := lower(COALESCE(v_first.position, ''));
    IF v_pos IN ('contractor_supervisor', 'contractor_pic')
       AND (v_first.approver_id IS NULL OR v_first.approver_id = v_uid)
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
       WHERE id=v_first.id;

      -- Stamp 상신 signature slot for permits (approval path only)
      IF _entity_type='work_permit' THEN
        PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
        UPDATE public.work_permits wp
           SET signatures = COALESCE(wp.signatures, '{}'::jsonb) || jsonb_build_object(
                 'contractor_pic', jsonb_build_object(
                   'name', COALESCE(v_first.approver_name, ''),
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
         AND status='대기' AND step_order > v_first.step_order
       ORDER BY step_order ASC
       LIMIT 1;

      IF FOUND THEN
        UPDATE public.approvals SET status='진행중', updated_at=v_now WHERE id=v_next.id;
      ELSE
        -- Single-step line: finalize
        IF _entity_type='work_permit' THEN
          PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
          UPDATE public.work_permits
             SET status='승인', approved_at=v_now, approved_by=v_uid, updated_at=v_now
           WHERE id=_entity_id AND COALESCE(status,'') NOT IN ('종료대기','종료완료');
        ELSIF _entity_type='work_plan' THEN
          UPDATE public.work_plans SET status='승인', updated_at=v_now WHERE id=_entity_id;
        ELSIF _entity_type='assessment_run' THEN
          BEGIN
            UPDATE public.assessment_runs SET status='approved', updated_at=v_now WHERE id=_entity_id;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      END IF;
    ELSE
      -- Normal: first step becomes active
      UPDATE public.approvals SET status='진행중', updated_at=v_now WHERE id=v_first.id;
    END IF;
  END IF;

  RETURN v_inserted;
END;
$function$;

-- act_on_entity_approval: skip lock when stamping signatures / status
CREATE OR REPLACE FUNCTION public.act_on_entity_approval(
  _approval_id uuid,
  _action text,
  _comment text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _a record;
  _next record;
  _prior_pending integer;
  _now timestamptz := now();
  _all_done boolean;
  _plan_id uuid;
  _permit record;
  _sigs jsonb;
  _title text;
  _sig_key text;
  _slot jsonb;
  _pos text;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_ACTIVE_STEP'); END IF;

  -- Never allow 승인/반려 on 상신(submission) step — must be auto-completed on submit
  _pos := lower(COALESCE(_a.position, ''));
  IF _pos IN ('contractor_supervisor', 'contractor_pic') THEN
    RETURN jsonb_build_object('error','SUBMITTER_STEP_NO_SELF_APPROVE');
  END IF;

  SELECT COUNT(*) INTO _prior_pending FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version
     AND step_order < _a.step_order
     AND status NOT IN ('승인')
     AND lower(COALESCE(position,'')) <> 'closure_sm';
  IF lower(COALESCE(_a.position,'')) <> 'closure_sm' AND _prior_pending > 0 THEN
    RETURN jsonb_build_object('error','PRIOR_STEP_NOT_APPROVED');
  END IF;

  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error','NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;

  -- Approval path may stamp signatures / form_data under lock
  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);

  -- Independent per-approver clock (this row only) — never UPDATE whole work_permits form
  UPDATE public.approvals
     SET status = CASE WHEN _action='approve' THEN '승인' ELSE '반려' END,
         comment = COALESCE(_comment,''),
         approved_at=_now,
         updated_at=_now
   WHERE id=_approval_id;

  -- Persist THIS approver's stamp into work_permits.signatures[slot] only
  IF _action='approve' AND _a.entity_type = 'work_permit' THEN
    _sig_key := public.permit_sig_key_for_position(_a.position);
    IF _sig_key IS NOT NULL THEN
      SELECT * INTO _permit FROM public.work_permits WHERE id = _a.entity_id;
      IF FOUND THEN
        _sigs := COALESCE(_permit.signatures, '{}'::jsonb);
        _slot := COALESCE(_sigs->_sig_key, '{}'::jsonb);
        _slot := jsonb_build_object(
          'name', COALESCE(NULLIF(_a.approver_name, ''), _slot->>'name', ''),
          'signature', COALESCE(_slot->>'signature', ''),
          'signed_at', _now
        );
        _sigs := _sigs || jsonb_build_object(_sig_key, _slot);
        IF _sig_key = 'cm' THEN
          _sigs := _sigs || jsonb_build_object('reviewed_at', _now);
        ELSIF _sig_key = 'sm' THEN
          _sigs := _sigs || jsonb_build_object('approved_at', _now);
        ELSIF _sig_key = 'closure_approver' THEN
          _sigs := _sigs || jsonb_build_object('closed_at', _now);
        END IF;
        UPDATE public.work_permits
           SET signatures = _sigs, updated_at = _now
         WHERE id = _a.entity_id;
      END IF;
    END IF;
  END IF;

  IF _action='reject' AND lower(COALESCE(_a.position,'')) = 'closure_sm' THEN
    UPDATE public.work_permits
       SET status='종료대기', updated_at=_now
     WHERE id=_a.entity_id;
    RETURN jsonb_build_object('success', true, 'action','closure_rejected');
  END IF;

  IF _action='reject' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version AND status IN ('대기','진행중');

    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='반려', updated_at=_now WHERE id=_a.entity_id;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits
         SET status='반려',
             rejection_reason=COALESCE(_comment,''),
             updated_at=_now
       WHERE id=_a.entity_id;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='rejected', updated_at=_now WHERE id=_a.entity_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','rejected');
  END IF;

  IF _action='approve' AND lower(COALESCE(_a.position,'')) = 'closure_sm'
     AND _a.entity_type = 'work_permit' THEN
    SELECT * INTO _permit FROM public.work_permits WHERE id = _a.entity_id;
    UPDATE public.work_permits
       SET status = '종료완료',
           form_data = COALESCE(form_data, '{}'::jsonb) || jsonb_build_object(
             'closed_at', _now,
             'closed_by', auth.uid(),
             'closed_by_name', COALESCE(_a.approver_name, '')
           ),
           updated_at = _now
     WHERE id = _a.entity_id;

    _title := COALESCE(NULLIF(_permit.work_name, ''), NULLIF(_permit.work_description, ''), '작업허가서');
    IF _permit.created_by IS NOT NULL THEN
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES
        (_permit.created_by, _permit.project_id, 'approval_result',
         '작업 완료 확인 완료',
         _title || ' 허가서가 종료(마감)되었습니다.',
         _title || ' 허가서가 종료(마감)되었습니다.',
         'work_permit', _permit.id::text, '/work-permits/' || _permit.id::text, false);
    END IF;

    RETURN jsonb_build_object('success', true, 'action','closed', 'finalized', true);
  END IF;

  SELECT * INTO _next FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version
     AND status='대기'
     AND step_order>_a.step_order
   ORDER BY step_order ASC
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.approvals SET status='진행중', updated_at=_now WHERE id=_next.id;
    RETURN jsonb_build_object('success', true, 'action','forwarded', 'next_step_order', _next.step_order);
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type=_a.entity_type
       AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version
       AND status IN ('대기','진행중')
  ) INTO _all_done;

  IF _all_done THEN
    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='승인', updated_at=_now WHERE id=_a.entity_id
        RETURNING id INTO _plan_id;
      IF _plan_id IS NOT NULL THEN
        UPDATE public.work_permits
           SET status = CASE WHEN status IN ('승인','발행완료','반려','종료대기','종료완료') THEN status ELSE '승인' END,
               approved_at = COALESCE(approved_at, _now),
               updated_at = _now
         WHERE work_plan_id = _plan_id
           AND COALESCE(status,'') NOT IN ('승인','발행완료','반려','종료대기','종료완료');
      END IF;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits
         SET status='승인',
             approved_at=_now,
             approved_by=auth.uid(),
             updated_at=_now
       WHERE id=_a.entity_id
         AND COALESCE(status,'') NOT IN ('종료대기','종료완료');
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='approved', updated_at=_now WHERE id=_a.entity_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.act_on_approval(
  _approval_id uuid,
  _action text,
  _comment text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.act_on_entity_approval(_approval_id, _action, _comment);
$function$;

-- Heal stuck self-approval: 상신 step still 진행중 while document is 결재중
DO $$
DECLARE
  r record;
  nxt uuid;
BEGIN
  FOR r IN
    SELECT a.id AS approval_id, a.entity_type, a.entity_id, a.approval_version, a.step_order,
           a.approver_name, a.position
      FROM public.approvals a
      LEFT JOIN public.work_permits wp
        ON a.entity_type='work_permit' AND wp.id=a.entity_id
      LEFT JOIN public.work_plans wpl
        ON a.entity_type='work_plan' AND wpl.id=a.entity_id
     WHERE a.status='진행중'
       AND lower(COALESCE(a.position,'')) IN ('contractor_supervisor','contractor_pic')
       AND (
         (a.entity_type='work_permit' AND wp.status='결재중'
           AND a.approver_id = COALESCE(wp.submitted_by, wp.created_by))
         OR
         (a.entity_type='work_plan' AND wpl.status='결재중'
           AND a.approver_id IS NOT NULL)
         OR
         (a.entity_type='assessment_run')
       )
  LOOP
    UPDATE public.approvals
       SET status='승인',
           approved_at=COALESCE(approved_at, now()),
           comment=CASE WHEN COALESCE(comment,'')='' THEN '[상신 완료·자동치유]' ELSE comment END,
           updated_at=now()
     WHERE id=r.approval_id;

    SELECT id INTO nxt FROM public.approvals
     WHERE entity_type=r.entity_type AND entity_id=r.entity_id
       AND approval_version=r.approval_version
       AND status='대기' AND step_order > r.step_order
     ORDER BY step_order ASC LIMIT 1;

    IF nxt IS NOT NULL THEN
      UPDATE public.approvals SET status='진행중', updated_at=now() WHERE id=nxt;
    END IF;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_approval(text, uuid, uuid, uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.act_on_approval(uuid, text, text) TO authenticated, service_role;

-- Allow withdraw after auto-approved 상신 (before any real approver decision)
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

  SELECT MAX(approval_version), MAX(project_id)
    INTO v_version, v_project
    FROM public.approvals
   WHERE entity_type=_entity_type AND entity_id=_entity_id;

  IF v_version IS NULL THEN
    RETURN jsonb_build_object('error','NO_APPROVAL');
  END IF;

  -- 상신 자동승인은 회수 허용; 그 외 승인/반려가 있으면 차단
  SELECT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type=_entity_type AND entity_id=_entity_id
       AND approval_version=v_version
       AND (
         status = '반려'
         OR (
           status = '승인'
           AND lower(COALESCE(position,'')) NOT IN ('contractor_supervisor','contractor_pic')
         )
       )
  ) INTO v_has_decided;
  IF v_has_decided THEN
    RETURN jsonb_build_object('error','ALREADY_DECIDED');
  END IF;

  IF _entity_type='work_plan' THEN
    SELECT created_by INTO v_creator FROM public.work_plans WHERE id=_entity_id;
  ELSIF _entity_type='work_permit' THEN
    SELECT created_by INTO v_creator FROM public.work_permits WHERE id=_entity_id;
  ELSIF _entity_type='assessment_run' THEN
    SELECT created_by INTO v_creator FROM public.assessment_runs WHERE id=_entity_id;
  END IF;

  SELECT public.is_master(v_uid)
      OR EXISTS (SELECT 1 FROM public.project_members
                  WHERE project_id=v_project AND user_id=v_uid
                    AND role IN ('project_admin','safety_manager'))
    INTO v_is_admin;

  IF v_creator IS DISTINCT FROM v_uid AND NOT v_is_admin THEN
    RETURN jsonb_build_object('error','NOT_SUBMITTER');
  END IF;

  -- Cancel remaining + already auto-approved 상신 steps in this version
  UPDATE public.approvals
     SET status='취소',
         comment=COALESCE(comment,'') ||
           CASE WHEN _reason IS NOT NULL AND _reason<>''
                THEN E'\n[회수] ' || _reason
                ELSE E'\n[회수] 상신자에 의해 회수됨' END,
         updated_at=v_now
   WHERE entity_type=_entity_type AND entity_id=_entity_id
     AND approval_version=v_version
     AND status IN ('진행중','대기','승인');

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF _entity_type='work_plan' THEN
    UPDATE public.work_plans SET status='작성중', updated_at=v_now WHERE id=_entity_id;
  ELSIF _entity_type='work_permit' THEN
    PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
    UPDATE public.work_permits SET status='작성중', updated_at=v_now WHERE id=_entity_id;
  ELSIF _entity_type='assessment_run' THEN
    BEGIN
      UPDATE public.assessment_runs SET status='draft', updated_at=v_now WHERE id=_entity_id;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('success', true, 'withdrawn_steps', v_affected, 'version', v_version);
END; $function$;

GRANT EXECUTE ON FUNCTION public.withdraw_approval(text, uuid, text) TO authenticated, service_role;
