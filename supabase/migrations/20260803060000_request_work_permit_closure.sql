-- Manual "작업 완료 결재 요청" for a single approved permit (after gas measurement).
-- Complements time-based promote_permits_to_closure_pending().

CREATE OR REPLACE FUNCTION public.request_work_permit_closure(_permit_id uuid)
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
  v_sup_id uuid;
  v_sup_name text;
  v_ver integer;
  v_order integer;
  v_title text;
  v_gas jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;
  IF _permit_id IS NULL THEN
    RETURN jsonb_build_object('error', 'PERMIT_ID_REQUIRED');
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
  IF COALESCE(r.status, '') IN ('종료완료', 'CLOSED', '마감') THEN
    RETURN jsonb_build_object('error', 'ALREADY_CLOSED');
  END IF;
  IF COALESCE(r.status, '') IN ('종료대기', 'CLOSURE_PENDING') THEN
    RETURN jsonb_build_object('error', 'ALREADY_CLOSURE_PENDING');
  END IF;
  IF COALESCE(r.status, '') NOT IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved') THEN
    RETURN jsonb_build_object('error', 'NOT_APPROVED');
  END IF;

  -- Skip while extension approval is open
  IF EXISTS (
    SELECT 1 FROM public.approvals a
     WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) = 'extend_sm'
       AND a.status IN ('대기', '진행중')
  ) THEN
    RETURN jsonb_build_object('error', 'PENDING_POST_APPROVAL');
  END IF;

  -- Already has closure steps
  IF EXISTS (
    SELECT 1 FROM public.approvals a
     WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) IN ('closure_sm', 'closure_supervisor')
       AND a.status IN ('대기', '진행중', '승인')
  ) THEN
    PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
    UPDATE public.work_permits
       SET status = '종료대기', updated_at = now()
     WHERE id = r.id AND status IS DISTINCT FROM '종료대기';
    RETURN jsonb_build_object('success', true, 'already', true, 'status', '종료대기');
  END IF;

  -- Gas required before requesting closure (same gate as closure approve)
  v_gas := public.permit_gas_closure_gate(r.id);
  IF COALESCE((v_gas->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'error', COALESCE(v_gas->>'error', 'GAS_MEASUREMENT_REQUIRED'),
      'missing', COALESCE(v_gas->'missing', '[]'::jsonb)
    );
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
    RETURN jsonb_build_object('error', 'NO_SM');
  END IF;

  -- Resolve 관리감독자
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
    INSERT INTO public.approvals (
      project_id, entity_type, entity_id, step, step_order, status, approval_version,
      approver_id, approver_name, position
    ) VALUES (
      r.project_id, 'work_permit', r.id,
      '작업 완료 확인', GREATEST(v_order, 90), '진행중', COALESCE(v_ver, 1),
      v_sm_id, COALESCE(v_sm_name, ''), 'closure_sm'
    );
  END IF;

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
  UPDATE public.work_permits
     SET status = '종료대기',
         form_data = COALESCE(form_data, '{}'::jsonb) || jsonb_build_object(
           'work_closure_requested_at', now(),
           'work_closure_requested_by', v_uid
         ),
         updated_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', '종료대기',
    'supervisor_id', v_sup_id,
    'sm_id', v_sm_id,
    'title', v_title
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_work_permit_closure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_work_permit_closure(uuid) TO authenticated, service_role;
