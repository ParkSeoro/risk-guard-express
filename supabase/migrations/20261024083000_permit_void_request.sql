-- 허가서 작업취소 요청.
-- 즉시 취소(void_work_document)는 유지하고, 연결된 TBM만 종료한다.
-- act_on_entity_approval 은 라이브 본문과 같은 20260827222748 에 조기 분기만 추가한다.
-- 서명 슬롯(permit_sig_key_for_position)에는 void_request_client 를 넣지 않는다.


CREATE OR REPLACE FUNCTION public.request_work_permit_void(
  _permit_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_uid uuid := auth.uid();
  r public.work_permits%ROWTYPE;
  v_reason text;
  v_parent uuid;
  v_allowed boolean := false;
  v_name text;
  v_sm_id uuid;
  v_sm_name text;
  v_cm_id uuid;
  v_cm_name text;
  v_approver uuid;
  v_approver_name text;
  v_ver integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;
  v_reason := btrim(COALESCE(_reason, ''));
  IF v_reason = '' THEN
    RETURN jsonb_build_object('error', 'REASON_REQUIRED');
  END IF;
  IF char_length(v_reason) > 500 THEN
    v_reason := left(v_reason, 500);
  END IF;

  SELECT * INTO r FROM public.work_permits WHERE id = _permit_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(r.is_deleted, false) THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;
  IF NOT public.is_project_member(v_uid, r.project_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  IF r.voided_at IS NOT NULL OR COALESCE(r.status, '') = '작업취소' THEN
    RETURN jsonb_build_object('error', 'ALREADY_VOIDED');
  END IF;
  IF COALESCE(r.status, '') NOT IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved') THEN
    RETURN jsonb_build_object('error', 'NOT_APPROVED');
  END IF;

  -- has_project_role() is true for every master, so do not use it for the requester allow-list.
  IF public.is_master(v_uid) OR EXISTS (
    SELECT 1 FROM public.project_members pm
     WHERE pm.user_id = v_uid
       AND pm.project_id = r.project_id
       AND pm.role_new = 'project_admin'::public.project_role
  ) THEN
    RETURN jsonb_build_object('error', 'USE_DIRECT_VOID');
  END IF;

  IF r.created_by IS NOT NULL AND r.created_by = v_uid THEN
    v_allowed := true;
  ELSE
    SELECT pc.parent_company_id INTO v_parent
      FROM public.project_companies pc
     WHERE pc.project_id = r.project_id
       AND pc.company_id = r.company_id
       AND COALESCE(pc.is_deleted, false) = false
     ORDER BY pc.created_at ASC NULLS LAST
     LIMIT 1;

    v_allowed := EXISTS (
      SELECT 1
        FROM public.project_members pm
        LEFT JOIN public.companies c ON c.id = pm.company_id
       WHERE pm.user_id = v_uid
         AND pm.project_id = r.project_id
         AND pm.role_new IN ('site_manager'::public.project_role, 'safety_manager'::public.project_role)
         AND pm.company_id IS NOT NULL
         AND (pm.company_id = r.company_id OR (v_parent IS NOT NULL AND pm.company_id = v_parent))
         AND lower(COALESCE(c.type, '')) NOT IN ('client', '발주처', 'owner')
    );
  END IF;
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.approvals a
     WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) = 'void_request_client'
       AND a.status IN ('대기', '진행중')
  ) THEN
    RETURN jsonb_build_object('error', 'ALREADY_PENDING');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.approvals a
     WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) IN (
         'closure_supervisor', 'closure_sm', 'extend_sm', 'extend_cm'
       )
       AND a.status IN ('대기', '진행중')
  ) THEN
    RETURN jsonb_build_object('error', 'PENDING_POST_APPROVAL');
  END IF;

  SELECT a.approver_id, a.approver_name
    INTO v_sm_id, v_sm_name
    FROM public.approvals a
   WHERE a.entity_type = 'work_permit'
     AND a.entity_id = r.id
     AND lower(COALESCE(a.position, '')) IN ('owner_sm', 'sm')
     AND a.status = '승인'
     AND a.approver_id IS NOT NULL
     AND a.approver_id IS DISTINCT FROM v_uid
   ORDER BY a.approval_version DESC, a.step_order DESC
   LIMIT 1;

  IF v_sm_id IS NULL THEN
    SELECT pm.user_id, COALESCE(pr.display_name, '')
      INTO v_sm_id, v_sm_name
      FROM public.project_members pm
      LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
      LEFT JOIN public.companies c ON c.id = pm.company_id
     WHERE pm.project_id = r.project_id
       AND pm.user_id IS DISTINCT FROM v_uid
       AND (
         lower(COALESCE(pm.position_new::text, '')) IN ('owner_sm', 'owner_hse')
         OR lower(COALESCE(pm.role_new::text, '')) = 'safety_manager'
       )
       AND lower(COALESCE(c.type, '')) IN ('client', '발주처', 'owner')
     ORDER BY pm.created_at ASC NULLS LAST
     LIMIT 1;
  END IF;

  v_approver := v_sm_id;
  v_approver_name := v_sm_name;

  IF v_approver IS NULL THEN
    SELECT a.approver_id, a.approver_name
      INTO v_cm_id, v_cm_name
      FROM public.approvals a
     WHERE a.entity_type = 'work_permit'
       AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) IN ('owner_cm', 'cm')
       AND a.status = '승인'
       AND a.approver_id IS NOT NULL
       AND a.approver_id IS DISTINCT FROM v_uid
     ORDER BY a.approval_version DESC, a.step_order DESC
     LIMIT 1;

    IF v_cm_id IS NULL THEN
      SELECT pm.user_id, COALESCE(pr.display_name, '')
        INTO v_cm_id, v_cm_name
        FROM public.project_members pm
        LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
        LEFT JOIN public.companies c ON c.id = pm.company_id
       WHERE pm.project_id = r.project_id
         AND pm.user_id IS DISTINCT FROM v_uid
         AND (
           lower(COALESCE(pm.position_new::text, '')) IN ('owner_cm', 'owner_pm')
           OR lower(COALESCE(pm.role_new::text, '')) = 'project_admin'
         )
         AND lower(COALESCE(c.type, '')) IN ('client', '발주처', 'owner')
       ORDER BY pm.created_at ASC NULLS LAST
       LIMIT 1;
    END IF;
    v_approver := v_cm_id;
    v_approver_name := v_cm_name;
  END IF;

  IF v_approver IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_CLIENT_APPROVER');
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid LIMIT 1;
  v_name := COALESCE(NULLIF(btrim(v_name), ''), '작성자');

  SELECT COALESCE(MAX(approval_version), 0) + 1 INTO v_ver
    FROM public.approvals
   WHERE entity_type = 'work_permit' AND entity_id = r.id;

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
  UPDATE public.work_permits
     SET form_data = COALESCE(form_data, '{}'::jsonb) || jsonb_build_object(
           'work_void_requested_reason', v_reason,
           'work_void_requested_at', now(),
           'work_void_requested_by', v_uid,
           'work_void_requested_by_name', v_name
         ),
         updated_at = now()
   WHERE id = r.id;

  INSERT INTO public.approvals (
    project_id, entity_type, entity_id, step, step_order, status, approval_version,
    approver_id, approver_name, position
  ) VALUES (
    r.project_id, 'work_permit', r.id,
    '작업취소 승인', 1, '진행중', v_ver,
    v_approver, COALESCE(v_approver_name, ''), 'void_request_client'
  );

  RETURN jsonb_build_object(
    'success', true,
    'approval_version', v_ver,
    'approver_id', v_approver,
    'status', r.status
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.request_work_permit_void(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_work_permit_void(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.request_work_permit_void(uuid, text) IS
  '발행 허가서 작업취소 요청. 상태는 바꾸지 않고 발주처 SM(없으면 CM) 한 단계만 연다.';

CREATE OR REPLACE FUNCTION public.void_work_document(
  _entity_type text,
  _entity_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := btrim(COALESCE(_reason, ''));
  v_project_id uuid;
  v_status text;
  v_voided_at timestamptz;
  v_is_deleted boolean;
  v_name text;
  v_label text;
  v_doc_title text;
  v_link text;
  v_title text;
  v_msg text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;
  IF v_reason = '' THEN
    RETURN jsonb_build_object('error', 'REASON_REQUIRED');
  END IF;
  IF _entity_type IS DISTINCT FROM 'work_permit' AND _entity_type IS DISTINCT FROM 'work_plan' THEN
    RETURN jsonb_build_object('error', 'INVALID_TYPE');
  END IF;

  IF _entity_type = 'work_permit' THEN
    SELECT project_id, status, voided_at, COALESCE(is_deleted, false)
      INTO v_project_id, v_status, v_voided_at, v_is_deleted
      FROM public.work_permits WHERE id = _entity_id;
  ELSE
    SELECT project_id, status, voided_at, COALESCE(is_deleted, false)
      INTO v_project_id, v_status, v_voided_at, v_is_deleted
      FROM public.work_plans WHERE id = _entity_id;
  END IF;

  IF v_project_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;
  IF v_is_deleted THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;
  IF v_voided_at IS NOT NULL OR v_status = '작업취소' THEN
    RETURN jsonb_build_object('error', 'ALREADY_VOIDED');
  END IF;
  IF v_status IS NULL OR v_status NOT IN (
    '결재중', '결재진행', '검토대기', '검토완료', '대기',
    '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED',
    '종료대기', 'CLOSURE_PENDING', '완료'
  ) THEN
    RETURN jsonb_build_object('error', 'NOT_VOIDABLE');
  END IF;

  IF NOT public.has_project_role(
    v_uid,
    v_project_id,
    ARRAY['project_admin']::public.project_role[]
  ) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid LIMIT 1;
  v_name := COALESCE(NULLIF(btrim(v_name), ''), '프로젝트 관리자');

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
  PERFORM set_config('app.skip_document_edit_lock', '1', true);

  IF _entity_type = 'work_permit' THEN
    UPDATE public.work_permits
       SET status = '작업취소',
           voided_at = now(),
           voided_by = v_uid,
           voided_reason = v_reason,
           voided_by_name = v_name,
           form_data = COALESCE(form_data, '{}'::jsonb)
             - 'work_void_requested_reason'
             - 'work_void_requested_at'
             - 'work_void_requested_by'
             - 'work_void_requested_by_name',
           updated_at = now()
     WHERE id = _entity_id;
    UPDATE public.tbm_sessions
       SET is_active = false
     WHERE id = (SELECT tbm_session_id FROM public.work_permits WHERE id = _entity_id);
    PERFORM public.cancel_open_approvals_for_entity('work_permit', _entity_id, '[작업취소]');
    SELECT COALESCE(NULLIF(work_name,''), NULLIF(work_description,''), '작업허가서')
      INTO v_doc_title FROM public.work_permits WHERE id = _entity_id;
    v_label := '작업허가서';
    v_link := '/work-permits/' || _entity_id::text;
  ELSE
    UPDATE public.work_plans
       SET status = '작업취소',
           voided_at = now(),
           voided_by = v_uid,
           voided_reason = v_reason,
           voided_by_name = v_name,
           updated_at = now()
     WHERE id = _entity_id;
    PERFORM public.cancel_open_approvals_for_entity('work_plan', _entity_id, '[작업취소]');
    SELECT COALESCE(NULLIF(title,''), '작업계획서')
      INTO v_doc_title FROM public.work_plans WHERE id = _entity_id;
    v_label := '작업계획서';
    v_link := '/work-plan/' || _entity_id::text;
  END IF;

  v_title := v_label || ' 작업 취소';
  v_msg := COALESCE(v_doc_title, v_label) || '이(가) 작업 취소되었습니다.'
        || E'\n사유: ' || v_reason
        || E'\n취소자: ' || v_name;

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body,
    related_type, related_id, link, severity, is_read
  )
  SELECT DISTINCT a.approver_id, v_project_id, 'approval_result',
         v_title, v_msg, v_msg,
         _entity_type, _entity_id::text, v_link, 'warning', false
    FROM public.approvals a
   WHERE a.entity_type = _entity_type
     AND a.entity_id = _entity_id
     AND a.approver_id IS NOT NULL
     AND a.approver_id IS DISTINCT FROM v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.request_work_permit_closure(_permit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_uid uuid := auth.uid();
  r public.work_permits%ROWTYPE;
  v_sm_id uuid;
  v_sm_name text;
  v_sup_id uuid;
  v_sup_name text;
  v_ver integer;
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

  IF EXISTS (
    SELECT 1 FROM public.approvals a
     WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) = 'void_request_client'
       AND a.status IN ('대기', '진행중')
  ) THEN
    RETURN jsonb_build_object('error', 'PENDING_POST_APPROVAL');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.approvals a
     WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) = 'extend_sm'
       AND a.status IN ('대기', '진행중')
  ) THEN
    RETURN jsonb_build_object('error', 'PENDING_POST_APPROVAL');
  END IF;

  -- Open/approved closure already present → do not recreate
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

  v_gas := public.permit_gas_closure_gate(r.id);
  IF COALESCE((v_gas->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'error', COALESCE(v_gas->>'error', 'GAS_MEASUREMENT_REQUIRED'),
      'missing', COALESCE(v_gas->'missing', '[]'::jsonb)
    );
  END IF;

  -- Resolve SM (identity only — version is always NEW)
  SELECT a.approver_id, a.approver_name
    INTO v_sm_id, v_sm_name
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
  END IF;

  IF v_sm_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_SM');
  END IF;

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

  -- NEW version for post-approval (never append to issuance version)
  SELECT COALESCE(MAX(approval_version), 0) + 1 INTO v_ver
    FROM public.approvals
   WHERE entity_type = 'work_permit' AND entity_id = r.id;

  v_title := COALESCE(NULLIF(r.work_name, ''), NULLIF(r.work_description, ''), '작업허가서');

  IF v_sup_id IS NOT NULL AND v_sup_id IS DISTINCT FROM v_sm_id THEN
    INSERT INTO public.approvals (
      project_id, entity_type, entity_id, step, step_order, status, approval_version,
      approver_id, approver_name, position
    ) VALUES (
      r.project_id, 'work_permit', r.id,
      '관리감독자 작업 완료 확인', 1, '진행중', v_ver,
      v_sup_id, COALESCE(v_sup_name, ''), 'closure_supervisor'
    );

    INSERT INTO public.approvals (
      project_id, entity_type, entity_id, step, step_order, status, approval_version,
      approver_id, approver_name, position
    ) VALUES (
      r.project_id, 'work_permit', r.id,
      '발주처 SM 작업 완료 승인', 2, '대기', v_ver,
      v_sm_id, COALESCE(v_sm_name, ''), 'closure_sm'
    );
  ELSE
    INSERT INTO public.approvals (
      project_id, entity_type, entity_id, step, step_order, status, approval_version,
      approver_id, approver_name, position
    ) VALUES (
      r.project_id, 'work_permit', r.id,
      '작업 완료 확인', 1, '진행중', v_ver,
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
    'approval_version', v_ver,
    'supervisor_id', v_sup_id,
    'sm_id', v_sm_id,
    'title', v_title
  );
END;
$body$;

CREATE OR REPLACE FUNCTION public.request_work_permit_extension(
  _permit_id uuid,
  _extend_until timestamptz,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_uid uuid := auth.uid();
  r public.work_permits%ROWTYPE;
  v_sm_id uuid;
  v_sm_name text;
  v_cm_id uuid;
  v_cm_name text;
  v_ver integer;
  v_eff_end timestamptz;
  v_title text;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;
  IF _extend_until IS NULL THEN
    RETURN jsonb_build_object('error', 'EXTEND_UNTIL_REQUIRED');
  END IF;
  v_reason := btrim(COALESCE(_reason, ''));
  IF v_reason = '' THEN
    RETURN jsonb_build_object('error', 'REASON_REQUIRED');
  END IF;
  IF char_length(v_reason) > 500 THEN
    v_reason := left(v_reason, 500);
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
       AND lower(COALESCE(a.position, '')) IN ('closure_sm', 'closure_supervisor', 'extend_sm', 'extend_cm', 'void_request_client')
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

  SELECT a.approver_id, a.approver_name
    INTO v_cm_id, v_cm_name
    FROM public.approvals a
   WHERE a.entity_type = 'work_permit'
     AND a.entity_id = r.id
     AND lower(COALESCE(a.position, '')) IN ('owner_cm', 'cm')
     AND a.status = '승인'
   ORDER BY a.approval_version DESC, a.step_order DESC
   LIMIT 1;

  IF v_cm_id IS NULL THEN
    SELECT pm.user_id, COALESCE(pr.display_name, '')
      INTO v_cm_id, v_cm_name
      FROM public.project_members pm
      LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
      LEFT JOIN public.companies c ON c.id = pm.company_id
     WHERE pm.project_id = r.project_id
       AND lower(COALESCE(pm.position_new::text, '')) IN ('owner_cm', 'owner_pm')
       AND lower(COALESCE(c.type, '')) IN ('client', '발주처', 'owner')
     ORDER BY pm.created_at ASC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_cm_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_CM');
  END IF;

  SELECT a.approver_id, a.approver_name
    INTO v_sm_id, v_sm_name
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
  END IF;

  IF v_sm_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_SM');
  END IF;

  SELECT COALESCE(MAX(approval_version), 0) + 1 INTO v_ver
    FROM public.approvals
   WHERE entity_type = 'work_permit' AND entity_id = r.id;

  v_title := COALESCE(NULLIF(r.work_name, ''), NULLIF(r.work_description, ''), '작업허가서');

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
  UPDATE public.work_permits
     SET form_data = COALESCE(form_data, '{}'::jsonb) || jsonb_build_object(
           'work_extend_requested_until', _extend_until,
           'work_extend_requested_at', now(),
           'work_extend_requested_by', v_uid,
           'work_extend_requested_reason', v_reason
         ),
         updated_at = now()
   WHERE id = r.id;

  INSERT INTO public.approvals (
    project_id, entity_type, entity_id, step, step_order, status, approval_version,
    approver_id, approver_name, position
  ) VALUES
    (
      r.project_id, 'work_permit', r.id,
      '작업허가 연장 검토 (~' || to_char(_extend_until AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ')',
      1, '진행중', v_ver,
      v_cm_id, COALESCE(v_cm_name, ''), 'extend_cm'
    ),
    (
      r.project_id, 'work_permit', r.id,
      '작업허가 연장 승인 (~' || to_char(_extend_until AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ')',
      2, '대기', v_ver,
      v_sm_id, COALESCE(v_sm_name, ''), 'extend_sm'
    );

  RETURN jsonb_build_object(
    'success', true,
    'extend_until', _extend_until,
    'approval_version', v_ver,
    'cm_id', v_cm_id,
    'approver_id', v_sm_id,
    'title', v_title
  );
END;
$body$;

CREATE OR REPLACE FUNCTION public.act_on_entity_approval(
  _approval_id uuid,
  _action text,
  _comment text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
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
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_ACTIVE_STEP'); END IF;

  _pos := lower(COALESCE(_a.position, ''));
  IF _pos IN ('contractor_supervisor', 'contractor_pic') THEN
    RETURN jsonb_build_object('error','SUBMITTER_STEP_NO_SELF_APPROVE');
  END IF;

  _is_post := _pos IN ('closure_supervisor', 'closure_sm', 'extend_sm', 'extend_cm', 'void_request_client');

  -- Only open prior steps block. 취소/반려 leftovers must not block.
  -- Post-approval steps only look at other post steps in the same version.
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
    ELSIF _a.entity_type='assessment_run' THEN
      UPDATE public.assessment_runs SET status='승인완료', updated_at=_now WHERE id=_a.entity_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', false);
END;
$body$;

NOTIFY pgrst, 'reload schema';
