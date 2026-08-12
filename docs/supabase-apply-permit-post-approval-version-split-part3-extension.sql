-- SafeNex PART 3/4: request_work_permit_extension — NEW approval_version
-- Paste into Supabase SQL Editor and Run alone, then the next part.
-- Uses body dollar-quotes (SQL Editor-safe).

CREATE OR REPLACE FUNCTION public.request_work_permit_extension(
  _permit_id uuid,
  _extend_until timestamptz
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
  v_ver integer;
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
    1, '진행중', v_ver,
    v_sm_id, COALESCE(v_sm_name, ''), 'extend_sm'
  );

  RETURN jsonb_build_object(
    'success', true,
    'extend_until', _extend_until,
    'approval_version', v_ver,
    'approver_id', v_sm_id,
    'title', v_title
  );
END;
$body$;
