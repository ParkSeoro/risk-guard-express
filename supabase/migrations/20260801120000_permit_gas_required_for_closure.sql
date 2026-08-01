-- Require gas measurement fields before work-completion (closure) approval.
-- All companies. DigPermitForm keys only — does not change approval line rules.

CREATE OR REPLACE FUNCTION public.permit_missing_gas_labels(
  _form_data jsonb,
  _kinds text[]
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  fd jsonb := COALESCE(_form_data, '{}'::jsonb);
  kinds text[] := COALESCE(_kinds, ARRAY[]::text[]);
  need_general boolean := 'general' = ANY (kinds);
  need_special boolean := ('hot_work' = ANY (kinds)) OR ('confined_space' = ANY (kinds));
  missing text[] := ARRAY[]::text[];
BEGIN
  IF need_general THEN
    IF NULLIF(btrim(COALESCE(fd->>'gas_o2','')), '') IS NULL THEN missing := array_append(missing, 'O₂ 농도'); END IF;
    IF NULLIF(btrim(COALESCE(fd->>'gas_co2','')), '') IS NULL THEN missing := array_append(missing, 'CO₂ 농도'); END IF;
    IF NULLIF(btrim(COALESCE(fd->>'gas_h2s','')), '') IS NULL THEN missing := array_append(missing, 'H₂S 농도'); END IF;
    IF NULLIF(btrim(COALESCE(fd->>'gas_co','')), '') IS NULL THEN missing := array_append(missing, 'CO 농도'); END IF;
    IF NULLIF(btrim(COALESCE(fd->>'gas_time','')), '') IS NULL THEN missing := array_append(missing, '측정시간'); END IF;
    IF NULLIF(btrim(COALESCE(fd->>'gas_measurer','')), '') IS NULL THEN missing := array_append(missing, '측정자'); END IF;
  END IF;

  IF need_special THEN
    IF NULLIF(btrim(COALESCE(fd->>'gas_o2','')), '') IS NULL AND NOT ('O₂ 농도' = ANY (missing)) THEN
      missing := array_append(missing, 'O₂ 농도');
    END IF;
    IF NULLIF(btrim(COALESCE(fd->>'gas_h2s','')), '') IS NULL AND NOT ('H₂S 농도' = ANY (missing)) THEN
      missing := array_append(missing, 'H₂S 농도');
    END IF;
    IF NULLIF(btrim(COALESCE(fd->>'gas_co','')), '') IS NULL AND NOT ('CO 농도' = ANY (missing)) THEN
      missing := array_append(missing, 'CO 농도');
    END IF;
    IF NULLIF(btrim(COALESCE(fd->>'gas_hc','')), '') IS NULL THEN
      missing := array_append(missing, 'H·C 농도');
    END IF;
    IF NULLIF(btrim(COALESCE(fd->>'gas_co2','')), '') IS NULL AND NOT ('CO₂ 농도' = ANY (missing)) THEN
      missing := array_append(missing, 'CO₂ 농도');
    END IF;
  END IF;

  RETURN missing;
END;
$function$;

CREATE OR REPLACE FUNCTION public.permit_gas_closure_gate(_permit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  kinds text[];
  missing text[];
BEGIN
  SELECT id, form_data, permit_kinds, permit_type
    INTO r
    FROM public.work_permits
   WHERE id = _permit_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PERMIT_NOT_FOUND');
  END IF;

  IF r.permit_kinds IS NOT NULL AND cardinality(r.permit_kinds) > 0 THEN
    kinds := r.permit_kinds;
  ELSIF NULLIF(r.permit_type, '') IS NOT NULL THEN
    kinds := ARRAY[r.permit_type];
  ELSE
    kinds := ARRAY['general'];
  END IF;

  missing := public.permit_missing_gas_labels(r.form_data, kinds);
  IF coalesce(array_length(missing, 1), 0) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'GAS_MEASUREMENT_REQUIRED',
      'missing', to_jsonb(missing)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Gas-only write path for issued / closure-pending permits (edit lock bypass)
CREATE OR REPLACE FUNCTION public.save_permit_gas_readings(
  _permit_id uuid,
  _readings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r record;
  patch jsonb := '{}'::jsonb;
  k text;
  allowed text[] := ARRAY[
    'gas_o2','gas_co2','gas_h2s','gas_co','gas_hc','gas_time','gas_measurer'
  ];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO r FROM public.work_permits WHERE id = _permit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  IF COALESCE(r.status, '') NOT IN ('승인', '발행완료', '종료대기') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATUS', 'status', r.status);
  END IF;

  IF NOT public.is_project_member(v_uid, r.project_id) AND NOT public.is_master(v_uid) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  FOREACH k IN ARRAY allowed LOOP
    IF _readings ? k THEN
      patch := patch || jsonb_build_object(k, COALESCE(_readings->>k, ''));
    END IF;
  END LOOP;

  IF patch = '{}'::jsonb THEN
    RETURN jsonb_build_object('error', 'EMPTY_READINGS');
  END IF;

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
  UPDATE public.work_permits
     SET form_data = COALESCE(form_data, '{}'::jsonb) || patch,
         updated_at = now()
   WHERE id = _permit_id;

  RETURN jsonb_build_object('success', true, 'form_data', (SELECT form_data FROM public.work_permits WHERE id = _permit_id));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.permit_missing_gas_labels(jsonb, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.permit_gas_closure_gate(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_permit_gas_readings(uuid, jsonb) TO authenticated, service_role;

-- Patch act_on_entity_approval: gate closure approve BEFORE mutating approval row.
-- Full body based on 20260730120000 + gas gate.
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
  _req_until timestamptz;
  _gas jsonb;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_ACTIVE_STEP'); END IF;

  _pos := lower(COALESCE(_a.position, ''));
  IF _pos IN ('contractor_supervisor', 'contractor_pic') THEN
    RETURN jsonb_build_object('error','SUBMITTER_STEP_NO_SELF_APPROVE');
  END IF;

  SELECT COUNT(*) INTO _prior_pending FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version
     AND step_order < _a.step_order
     AND status NOT IN ('승인')
     AND lower(COALESCE(position,'')) <> 'extend_sm';
  IF _prior_pending > 0 AND _pos <> 'extend_sm' THEN
    RETURN jsonb_build_object('error','PRIOR_STEP_NOT_APPROVED');
  END IF;

  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error','NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;

  -- Gas measurement required before work-completion approvals
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

  IF _action='reject' AND _pos = 'extend_sm' THEN
    UPDATE public.work_permits
       SET form_data = (COALESCE(form_data, '{}'::jsonb)
            - 'work_extend_requested_until'
            - 'work_extend_requested_at'
            - 'work_extend_requested_by'),
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
              - 'work_extend_requested_by')
            || jsonb_build_object(
                 'work_extend_until', to_char(_req_until AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI'),
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
    ELSIF _a.entity_type='assessment_run' THEN
      UPDATE public.assessment_runs SET status='승인완료', updated_at=_now WHERE id=_a.entity_id;
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
