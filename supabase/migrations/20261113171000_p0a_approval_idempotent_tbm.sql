-- P0-a: Timeline / Messenger approval (`act_on_entity_approval`) idempotent TBM session creation on final work_permit approval
-- AI briefing remains outside SQL/transaction (template briefing inserted here; client best-effort may enrich later).

CREATE OR REPLACE FUNCTION public.act_on_entity_approval(_approval_id uuid, _action text, _comment text DEFAULT ''::text)
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
  _req_until timestamptz;
  _gas jsonb;
  _is_post boolean;
  _has_active_tbm boolean := false;
  _work_date date;
  _work_start_raw text;
  _work_name text;
  _work_desc text;
  _work_loc text;
  _comp_name text;
  _briefing text;
  _tbm_id uuid;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_ACTIVE_STEP'); END IF;

  _pos := lower(COALESCE(_a.position, ''));
  IF _pos IN ('contractor_supervisor', 'contractor_pic') THEN
    RETURN jsonb_build_object('error','SUBMITTER_STEP_NO_SELF_APPROVE');
  END IF;

  _is_post := _pos IN ('closure_supervisor', 'closure_sm', 'extend_sm', 'extend_cm', 'void_request_client');

  SELECT COUNT(*) INTO _prior_pending FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version
     AND step_order < _a.step_order
     AND status IN ('대기', '진행중')
     AND (
       NOT _is_post
       OR lower(COALESCE(position,'')) IN ('closure_supervisor', 'closure_sm', 'extend_sm', 'extend_cm', 'void_request_client')
     );
  IF _prior_pending > 0 THEN
    RETURN jsonb_build_object('error','PRIOR_STEP_NOT_APPROVED');
  END IF;

  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error','NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;

  IF _action = 'approve'
     AND _a.entity_type = 'work_permit'
     AND _pos IN ('closure_supervisor', 'closure_sm') THEN
    _gas := public.permit_gas_closure_gate(_a.entity_id);
    IF COALESCE((_gas->>'ok')::boolean, false) IS NOT TRUE THEN
      RETURN _gas;
    END IF;
  END IF;

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);

  UPDATE public.approvals
     SET status = CASE WHEN _action='approve' THEN '승인' ELSE '반려' END,
         comment = COALESCE(_comment,''),
         approved_at=_now,
         updated_at=_now
   WHERE id=_approval_id;

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


  IF _action='reject' AND _pos = 'void_request_client' AND _a.entity_type = 'work_permit' THEN
    UPDATE public.work_permits
       SET form_data = COALESCE(form_data, '{}'::jsonb)
            - 'work_void_requested_reason'
            - 'work_void_requested_at'
            - 'work_void_requested_by'
            - 'work_void_requested_by_name',
           updated_at = _now
     WHERE id = _a.entity_id;
    RETURN jsonb_build_object('success', true, 'action', 'void_rejected', 'finalized', false);
  END IF;

  IF _action='approve' AND _pos = 'void_request_client' AND _a.entity_type = 'work_permit' THEN
    SELECT * INTO _permit FROM public.work_permits WHERE id = _a.entity_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'NOT_FOUND');
    END IF;
    IF _permit.voided_at IS NOT NULL OR COALESCE(_permit.status, '') = '작업취소' THEN
      RETURN jsonb_build_object('error', 'ALREADY_VOIDED');
    END IF;

    UPDATE public.work_permits
       SET status = '작업취소',
           voided_at = _now,
           voided_by = auth.uid(),
           voided_reason = COALESCE(
             NULLIF(btrim(_permit.form_data->>'work_void_requested_reason'), ''),
             NULLIF(btrim(_comment), ''),
             '작업취소 요청 승인'
           ),
           voided_by_name = COALESCE(NULLIF(btrim(_a.approver_name), ''), '발주처'),
           updated_at = _now
     WHERE id = _a.entity_id;

    UPDATE public.tbm_sessions
       SET is_active = false
     WHERE id = _permit.tbm_session_id;

    PERFORM public.cancel_open_approvals_for_entity('work_permit', _a.entity_id, '[작업취소]');

    INSERT INTO public.notifications (
      user_id, project_id, type, title, message, body,
      related_type, related_id, link, severity, is_read
    )
    SELECT DISTINCT s.user_id, _permit.project_id, 'approval_result',
           '작업허가서 작업 취소',
           COALESCE(NULLIF(_permit.work_name, ''), NULLIF(_permit.work_description, ''), '작업허가서')
             || '이(가) 작업 취소되었습니다.',
           COALESCE(NULLIF(_permit.work_name, ''), NULLIF(_permit.work_description, ''), '작업허가서')
             || '이(가) 작업 취소되었습니다.',
           'work_permit', _permit.id::text, '/work-permits/' || _permit.id::text, 'warning', false
      FROM (
        SELECT a.approver_id AS user_id
          FROM public.approvals a
         WHERE a.entity_type = 'work_permit'
           AND a.entity_id = _permit.id
           AND a.approver_id IS NOT NULL
        UNION
        SELECT _permit.created_by
        UNION
        SELECT CASE
          WHEN COALESCE(_permit.form_data->>'work_void_requested_by', '') ~* '^[0-9a-f-]{36}$'
          THEN (_permit.form_data->>'work_void_requested_by')::uuid
          ELSE NULL
        END
      ) s
     WHERE s.user_id IS NOT NULL
       AND s.user_id IS DISTINCT FROM auth.uid();

    RETURN jsonb_build_object('success', true, 'action', 'voided', 'finalized', true);
  END IF;

  IF _action='reject' AND _pos = 'closure_supervisor' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version
       AND status IN ('대기','진행중')
       AND lower(COALESCE(position,'')) = 'closure_sm';
    UPDATE public.work_permits SET status='종료대기', updated_at=_now WHERE id=_a.entity_id;
    RETURN jsonb_build_object('success', true, 'action','closure_supervisor_rejected');
  END IF;

  IF _action='reject' AND _pos = 'closure_sm' THEN
    UPDATE public.work_permits SET status='종료대기', updated_at=_now WHERE id=_a.entity_id;
    RETURN jsonb_build_object('success', true, 'action','closure_rejected');
  END IF;

  IF _action='reject' AND _pos = 'extend_cm' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version
       AND status IN ('대기','진행중')
       AND lower(COALESCE(position,'')) = 'extend_sm';
    UPDATE public.work_permits
       SET form_data = (COALESCE(form_data, '{}'::jsonb)
            - 'work_extend_requested_until'
            - 'work_extend_requested_at'
            - 'work_extend_requested_by'
            - 'work_extend_requested_reason'),
           updated_at = _now
     WHERE id = _a.entity_id;
    RETURN jsonb_build_object('success', true, 'action','extend_cm_rejected');
  END IF;

  IF _action='reject' AND _pos = 'extend_sm' THEN
    UPDATE public.work_permits
       SET form_data = (COALESCE(form_data, '{}'::jsonb)
            - 'work_extend_requested_until'
            - 'work_extend_requested_at'
            - 'work_extend_requested_by'
            - 'work_extend_requested_reason'),
           updated_at = _now
     WHERE id = _a.entity_id;
    RETURN jsonb_build_object('success', true, 'action','extend_rejected');
  END IF;

  IF _action='reject' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version AND status IN ('대기','진행중');

    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='반려', updated_at=_now WHERE id=_a.entity_id;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits
         SET status='반려', rejection_reason=COALESCE(_comment,''), updated_at=_now
       WHERE id=_a.entity_id;
    ELSIF _a.entity_type='assessment_run' THEN
      UPDATE public.assessment_runs SET status='반려', updated_at=_now WHERE id=_a.entity_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','rejected');
  END IF;

  IF _action='approve' AND _pos = 'extend_sm' AND _a.entity_type = 'work_permit' THEN
    SELECT * INTO _permit FROM public.work_permits WHERE id = _a.entity_id;
    _req_until := COALESCE(
      NULLIF(_permit.form_data->>'work_extend_requested_until', '')::timestamptz,
      NULLIF(_permit.form_data->>'work_extend_until', '')::timestamptz
    );
    IF _req_until IS NULL THEN
      RETURN jsonb_build_object('error', 'NO_REQUESTED_UNTIL');
    END IF;

    UPDATE public.work_permits
       SET extension_until = _req_until,
           valid_until = _req_until,
           form_data = (COALESCE(form_data, '{}'::jsonb)
              - 'work_extend_requested_until'
              - 'work_extend_requested_at'
              - 'work_extend_requested_by'
              - 'work_extend_requested_reason')
            || jsonb_build_object(
                 'work_extend_until', to_char(_req_until AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI'),
                 'work_extend_reason', COALESCE(NULLIF(_permit.form_data->>'work_extend_requested_reason', ''), ''),
                 'extended_at', _now,
                 'extended_by', auth.uid(),
                 'extended_by_name', COALESCE(_a.approver_name, '')
               ),
           updated_at = _now
     WHERE id = _a.entity_id;

    RETURN jsonb_build_object('success', true, 'action', 'extended', 'extend_until', _req_until);
  END IF;

  IF _action='approve' AND _pos = 'closure_supervisor' AND _a.entity_type = 'work_permit' THEN
    UPDATE public.work_permits
       SET form_data = COALESCE(form_data, '{}'::jsonb) || jsonb_build_object(
             'work_complete_time', to_char(_now AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
           ),
           updated_at = _now
     WHERE id = _a.entity_id;
  END IF;

  IF _action='approve' AND _pos = 'closure_sm' AND _a.entity_type = 'work_permit' THEN
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
      UPDATE public.work_plans SET status='승인완료', updated_at=_now WHERE id=_a.entity_id
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

      -- P0-a: Idempotently ensure a TBM session exists on final permit issuance (non-blocking).
      BEGIN
        SELECT * INTO _permit FROM public.work_permits WHERE id = _a.entity_id;
        IF FOUND
           AND COALESCE(_permit.is_deleted, false) = false
           AND _permit.voided_at IS NULL
           AND COALESCE(_permit.status, '') IN ('승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED') THEN
          _has_active_tbm := false;
          IF _permit.tbm_session_id IS NOT NULL THEN
            SELECT EXISTS (
              SELECT 1 FROM public.tbm_sessions
               WHERE id = _permit.tbm_session_id
                 AND COALESCE(is_deleted, false) = false
            ) INTO _has_active_tbm;
          END IF;

          IF NOT _has_active_tbm THEN
            _work_start_raw := NULLIF(btrim(COALESCE(_permit.form_data->>'work_start', '')), '');
            _work_date := NULL;
            IF _work_start_raw IS NOT NULL THEN
              IF _work_start_raw ~ '([zZ]|[+-]\d{2}:?\d{2})$' THEN
                BEGIN
                  _work_date := (_work_start_raw::timestamptz AT TIME ZONE 'Asia/Seoul')::date;
                EXCEPTION WHEN OTHERS THEN
                  _work_date := NULL;
                END;
              ELSIF _work_start_raw ~ '^\d{4}-\d{2}-\d{2}' THEN
                _work_date := substring(_work_start_raw from 1 for 10)::date;
              END IF;
            END IF;
            _work_date := COALESCE(
              _work_date,
              CASE WHEN _permit.work_start_at IS NOT NULL THEN (_permit.work_start_at AT TIME ZONE 'Asia/Seoul')::date ELSE NULL END,
              _permit.permit_date,
              (_now AT TIME ZONE 'Asia/Seoul')::date
            );

            _work_name := COALESCE(
              NULLIF(btrim(_permit.form_data->>'work_name'), ''),
              NULLIF(btrim(_permit.work_name), ''),
              NULLIF(btrim(_permit.work_description), ''),
              '작업'
            );
            _work_desc := COALESCE(
              NULLIF(btrim(_permit.form_data->>'work_description'), ''),
              NULLIF(btrim(_permit.work_description), ''),
              _work_name
            );
            _work_loc := COALESCE(
              NULLIF(btrim(_permit.form_data->>'work_location'), ''),
              NULLIF(btrim(_permit.location), ''),
              ''
            );
            _comp_name := COALESCE(
              NULLIF(btrim(_permit.form_data->>'contractor_company'), ''),
              NULLIF(btrim(_permit.contractor_company), ''),
              ''
            );
            _briefing := '【금일 작업】 ' || _work_desc
              || CASE WHEN _work_loc <> '' THEN E'\n【장소】 ' || _work_loc ELSE '' END
              || E'\n\n【중점 안전】\n- 작업 전 보호구·장비·건강상태를 확인합니다.\n- 위험구간 출입 시 관리자 지시에 따릅니다.\n- 이상 발견 시 즉시 작업을 중지하고 보고합니다.\n\n【금지·주의】\n무단 작업 금지\n보호구 미착용 작업 금지';

            INSERT INTO public.tbm_sessions (
              project_id,
              work_plan_id,
              run_id,
              company_id,
              company_name,
              title,
              tbm_date,
              location,
              work_content,
              special_notes,
              prohibited_actions,
              briefing_summary,
              is_active,
              created_by
            ) VALUES (
              _permit.project_id,
              _permit.work_plan_id,
              _permit.assessment_run_id,
              _permit.company_id,
              _comp_name,
              '[허가서] ' || _work_name,
              _work_date,
              _work_loc,
              _work_desc,
              E'보호구(안전모·안전화·안전대 등) 착용 확인\n건강이상·음주 여부 확인\n장비·공구 상태 확인\n작업장 정리정돈·출입로 확보',
              E'무단 작업 금지\n보호구 미착용 작업 금지',
              _briefing,
              true,
              COALESCE(_permit.created_by, auth.uid())
            )
            RETURNING id INTO _tbm_id;

            UPDATE public.work_permits
               SET tbm_session_id = _tbm_id,
                   updated_at = _now
             WHERE id = _permit.id
               AND (tbm_session_id IS NULL OR tbm_session_id = _permit.tbm_session_id);
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'P0-a ensure TBM on permit approval failed: %', SQLERRM;
      END;
    ELSIF _a.entity_type='assessment_run' THEN
      UPDATE public.assessment_runs SET status='승인완료', updated_at=_now WHERE id=_a.entity_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', false);
END;
$function$;
