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
