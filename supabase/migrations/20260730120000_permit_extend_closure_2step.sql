-- Work permit: 2-step closure (관리감독자 → 발주처 SM) + digital extension (extend_sm).

-- 1) Signature slot mapping
CREATE OR REPLACE FUNCTION public.permit_sig_key_for_position(_position text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(_position, ''))
    WHEN 'contractor_supervisor' THEN 'contractor_pic'
    WHEN 'contractor_pic' THEN 'contractor_pic'
    WHEN 'contractor_safety_manager' THEN 'safety_pic'
    WHEN 'safety_pic' THEN 'safety_pic'
    WHEN 'contractor_site_director' THEN 'site_director'
    WHEN 'site_director' THEN 'site_director'
    WHEN 'site_supervisor' THEN 'site_supervisor'
    WHEN 'closure_supervisor' THEN 'site_supervisor'
    WHEN 'gc' THEN 'gc_manager'
    WHEN 'gc_manager' THEN 'gc_manager'
    WHEN 'gc_pm' THEN 'gc_manager'
    WHEN 'owner_cm' THEN 'cm'
    WHEN 'cm' THEN 'cm'
    WHEN 'owner_sm' THEN 'sm'
    WHEN 'sm' THEN 'sm'
    WHEN 'closure_sm' THEN 'closure_approver'
    WHEN 'extend_sm' THEN 'extension_approver'
    ELSE NULL
  END;
$$;

-- 2) Promote to 종료대기 with supervisor → SM steps
CREATE OR REPLACE FUNCTION public.promote_permits_to_closure_pending()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_count integer := 0;
  v_sm_id uuid;
  v_sm_name text;
  v_sup_id uuid;
  v_sup_name text;
  v_ver integer;
  v_order integer;
  v_title text;
  v_eff_date date;
BEGIN
  FOR r IN
    SELECT p.*
      FROM public.work_permits p
     WHERE COALESCE(p.status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
       AND COALESCE(p.is_deleted, false) = false
  LOOP
    -- Effective end: extension → work_end → permit_date
    v_eff_date := COALESCE(
      (r.extension_until)::date,
      NULLIF(r.form_data->>'work_extend_until', '')::timestamptz::date,
      (r.work_end_at)::date,
      NULLIF(r.form_data->>'work_end', '')::timestamptz::date,
      NULLIF(r.permit_date::text, '')::date
    );
    IF v_eff_date IS NULL OR v_eff_date >= CURRENT_DATE THEN
      CONTINUE;
    END IF;

    -- Skip while extension approval is open
    IF EXISTS (
      SELECT 1 FROM public.approvals a
       WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
         AND lower(COALESCE(a.position, '')) = 'extend_sm'
         AND a.status IN ('대기', '진행중')
    ) THEN
      CONTINUE;
    END IF;

    -- Skip if closure already open/done
    IF EXISTS (
      SELECT 1 FROM public.approvals a
       WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
         AND lower(COALESCE(a.position, '')) IN ('closure_sm', 'closure_supervisor')
         AND a.status IN ('대기', '진행중', '승인')
    ) THEN
      UPDATE public.work_permits
         SET status = '종료대기', updated_at = now()
       WHERE id = r.id AND status IS DISTINCT FROM '종료대기';
      CONTINUE;
    END IF;

    -- Resolve SM (pre-work owner_sm)
    SELECT a.approver_id, a.approver_name, a.approval_version
      INTO v_sm_id, v_sm_name, v_ver
      FROM public.approvals a
     WHERE a.entity_type = 'work_permit'
       AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) IN ('owner_sm', 'sm')
       AND a.status = '승인'
     ORDER BY a.approval_version DESC, a.step_order DESC
     LIMIT 1;

    IF v_sm_id IS NULL THEN
      SELECT pm.user_id, COALESCE(pr.display_name, '')
        INTO v_sm_id, v_sm_name
        FROM public.project_members pm
        LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
        LEFT JOIN public.companies c ON c.id = pm.company_id
       WHERE pm.project_id = r.project_id
         AND (
           lower(COALESCE(pm.position_new::text, '')) IN ('owner_sm', 'owner_hse')
           OR lower(COALESCE(pm.role_new::text, '')) = 'safety_manager'
         )
         AND lower(COALESCE(c.type, '')) IN ('client', '발주처', 'owner')
       ORDER BY pm.created_at ASC NULLS LAST
       LIMIT 1;
      SELECT COALESCE(MAX(approval_version), 0) INTO v_ver
        FROM public.approvals WHERE entity_type = 'work_permit' AND entity_id = r.id;
    END IF;

    IF v_sm_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Resolve 관리감독자 (pre-work contractor_supervisor, else SITE_SUPERVISOR)
    v_sup_id := NULL;
    v_sup_name := NULL;
    SELECT a.approver_id, a.approver_name
      INTO v_sup_id, v_sup_name
      FROM public.approvals a
     WHERE a.entity_type = 'work_permit'
       AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) IN ('contractor_supervisor', 'site_supervisor')
       AND a.status = '승인'
       AND a.approver_id IS NOT NULL
     ORDER BY a.approval_version DESC, a.step_order ASC
     LIMIT 1;

    IF v_sup_id IS NULL THEN
      SELECT pm.user_id, COALESCE(pr.display_name, '')
        INTO v_sup_id, v_sup_name
        FROM public.project_members pm
        LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
       WHERE pm.project_id = r.project_id
         AND (
           upper(COALESCE(pm.position_new::text, '')) = 'SITE_SUPERVISOR'
           OR lower(COALESCE(pm.role_new::text, '')) IN ('site_supervisor', 'supervisor')
         )
         AND (r.company_id IS NULL OR pm.company_id = r.company_id)
       ORDER BY pm.created_at ASC NULLS LAST
       LIMIT 1;
    END IF;

    SELECT COALESCE(MAX(step_order), 0) + 1 INTO v_order
      FROM public.approvals
     WHERE entity_type = 'work_permit' AND entity_id = r.id AND approval_version = v_ver;

    v_title := COALESCE(NULLIF(r.work_name, ''), NULLIF(r.work_description, ''), '작업허가서');

    IF v_sup_id IS NOT NULL AND v_sup_id IS DISTINCT FROM v_sm_id THEN
      INSERT INTO public.approvals (
        project_id, entity_type, entity_id, step, step_order, status, approval_version,
        approver_id, approver_name, position
      ) VALUES (
        r.project_id, 'work_permit', r.id,
        '관리감독자 작업 완료 확인', GREATEST(v_order, 90), '진행중', COALESCE(v_ver, 1),
        v_sup_id, COALESCE(v_sup_name, ''), 'closure_supervisor'
      );

      INSERT INTO public.approvals (
        project_id, entity_type, entity_id, step, step_order, status, approval_version,
        approver_id, approver_name, position
      ) VALUES (
        r.project_id, 'work_permit', r.id,
        '발주처 SM 작업 완료 승인', GREATEST(v_order, 90) + 1, '대기', COALESCE(v_ver, 1),
        v_sm_id, COALESCE(v_sm_name, ''), 'closure_sm'
      );
    ELSE
      -- No distinct supervisor → SM-only (legacy fallback)
      INSERT INTO public.approvals (
        project_id, entity_type, entity_id, step, step_order, status, approval_version,
        approver_id, approver_name, position
      ) VALUES (
        r.project_id, 'work_permit', r.id,
        '작업 완료 확인', GREATEST(v_order, 90), '진행중', COALESCE(v_ver, 1),
        v_sm_id, COALESCE(v_sm_name, ''), 'closure_sm'
      );
    END IF;

    UPDATE public.work_permits
       SET status = '종료대기', updated_at = now()
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_permits_to_closure_pending() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_permits_to_closure_pending() TO service_role, authenticated;

-- 3) Request extension → extend_sm approval for 발주처 SM
CREATE OR REPLACE FUNCTION public.request_work_permit_extension(
  _permit_id uuid,
  _extend_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.work_permits%ROWTYPE;
  v_sm_id uuid;
  v_sm_name text;
  v_ver integer;
  v_order integer;
  v_eff_end timestamptz;
  v_title text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;
  IF _extend_until IS NULL THEN
    RETURN jsonb_build_object('error', 'EXTEND_UNTIL_REQUIRED');
  END IF;

  SELECT * INTO r FROM public.work_permits WHERE id = _permit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;
  IF NOT public.is_project_member(v_uid, r.project_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  IF COALESCE(r.is_deleted, false) THEN
    RETURN jsonb_build_object('error', 'DELETED');
  END IF;
  IF COALESCE(r.status, '') NOT IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved') THEN
    RETURN jsonb_build_object('error', 'NOT_APPROVED');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.approvals a
     WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) IN ('closure_sm', 'closure_supervisor', 'extend_sm')
       AND a.status IN ('대기', '진행중')
  ) THEN
    RETURN jsonb_build_object('error', 'PENDING_POST_APPROVAL');
  END IF;

  v_eff_end := COALESCE(
    r.extension_until,
    NULLIF(r.form_data->>'work_extend_until', '')::timestamptz,
    r.work_end_at,
    NULLIF(r.form_data->>'work_end', '')::timestamptz
  );
  IF v_eff_end IS NOT NULL AND _extend_until <= v_eff_end THEN
    RETURN jsonb_build_object('error', 'MUST_BE_AFTER_CURRENT_END');
  END IF;
  IF _extend_until <= now() THEN
    RETURN jsonb_build_object('error', 'MUST_BE_FUTURE');
  END IF;

  SELECT a.approver_id, a.approver_name, a.approval_version
    INTO v_sm_id, v_sm_name, v_ver
    FROM public.approvals a
   WHERE a.entity_type = 'work_permit'
     AND a.entity_id = r.id
     AND lower(COALESCE(a.position, '')) IN ('owner_sm', 'sm')
     AND a.status = '승인'
   ORDER BY a.approval_version DESC, a.step_order DESC
   LIMIT 1;

  IF v_sm_id IS NULL THEN
    SELECT pm.user_id, COALESCE(pr.display_name, '')
      INTO v_sm_id, v_sm_name
      FROM public.project_members pm
      LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
      LEFT JOIN public.companies c ON c.id = pm.company_id
     WHERE pm.project_id = r.project_id
       AND (
         lower(COALESCE(pm.position_new::text, '')) IN ('owner_sm', 'owner_hse')
         OR lower(COALESCE(pm.role_new::text, '')) = 'safety_manager'
       )
       AND lower(COALESCE(c.type, '')) IN ('client', '발주처', 'owner')
     ORDER BY pm.created_at ASC NULLS LAST
     LIMIT 1;
    SELECT COALESCE(MAX(approval_version), 0) INTO v_ver
      FROM public.approvals WHERE entity_type = 'work_permit' AND entity_id = r.id;
  END IF;

  IF v_sm_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_SM');
  END IF;

  SELECT COALESCE(MAX(step_order), 0) + 1 INTO v_order
    FROM public.approvals
   WHERE entity_type = 'work_permit' AND entity_id = r.id AND approval_version = v_ver;

  v_title := COALESCE(NULLIF(r.work_name, ''), NULLIF(r.work_description, ''), '작업허가서');

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
  UPDATE public.work_permits
     SET form_data = COALESCE(form_data, '{}'::jsonb) || jsonb_build_object(
           'work_extend_requested_until', _extend_until,
           'work_extend_requested_at', now(),
           'work_extend_requested_by', v_uid
         ),
         updated_at = now()
   WHERE id = r.id;

  INSERT INTO public.approvals (
    project_id, entity_type, entity_id, step, step_order, status, approval_version,
    approver_id, approver_name, position
  ) VALUES (
    r.project_id, 'work_permit', r.id,
    '작업허가 연장 승인 (~' || to_char(_extend_until AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ')',
    GREATEST(v_order, 80), '진행중', COALESCE(v_ver, 1),
    v_sm_id, COALESCE(v_sm_name, ''), 'extend_sm'
  );

  RETURN jsonb_build_object(
    'success', true,
    'extend_until', _extend_until,
    'approver_id', v_sm_id,
    'title', v_title
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_work_permit_extension(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_work_permit_extension(uuid, timestamptz) TO authenticated, service_role;

-- 4) act_on_entity_approval: sequential closure + extend_sm early return
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
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_ACTIVE_STEP'); END IF;

  _pos := lower(COALESCE(_a.position, ''));
  IF _pos IN ('contractor_supervisor', 'contractor_pic') THEN
    RETURN jsonb_build_object('error','SUBMITTER_STEP_NO_SELF_APPROVE');
  END IF;

  -- Sequential: do NOT bypass prior steps (closure_sm waits for closure_supervisor)
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

  -- Reject: closure_supervisor — cancel waiting SM, stay 종료대기
  IF _action='reject' AND _pos = 'closure_supervisor' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version
       AND status IN ('대기','진행중')
       AND lower(COALESCE(position,'')) = 'closure_sm';
    UPDATE public.work_permits SET status='종료대기', updated_at=_now WHERE id=_a.entity_id;
    RETURN jsonb_build_object('success', true, 'action','closure_supervisor_rejected');
  END IF;

  -- Reject: closure_sm — stay 종료대기
  IF _action='reject' AND _pos = 'closure_sm' THEN
    UPDATE public.work_permits SET status='종료대기', updated_at=_now WHERE id=_a.entity_id;
    RETURN jsonb_build_object('success', true, 'action','closure_rejected');
  END IF;

  -- Reject: extend_sm — clear request, keep approved
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

  -- Approve: extend_sm — stamp until + return (do not re-finalize initial approval)
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

  -- Approve: closure_supervisor — set complete time hint, then forward to SM
  IF _action='approve' AND _pos = 'closure_supervisor' AND _a.entity_type = 'work_permit' THEN
    UPDATE public.work_permits
       SET form_data = COALESCE(form_data, '{}'::jsonb) || jsonb_build_object(
             'work_complete_time', to_char(_now AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
           ),
           updated_at = _now
     WHERE id = _a.entity_id;
    -- fall through to next-step promotion
  END IF;

  -- Approve: closure_sm — finalize closed
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
