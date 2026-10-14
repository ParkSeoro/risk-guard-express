-- 허가서 연장 신청 철회: 신청자(work_extend_requested_by)만, 결재 대기/진행중일 때

CREATE OR REPLACE FUNCTION public.cancel_work_permit_extension(_permit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_uid uuid := auth.uid();
  r public.work_permits%ROWTYPE;
  v_req_by text;
  v_ver integer;
  v_cancelled integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
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

  IF NULLIF(r.form_data->>'work_extend_requested_until', '') IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_PENDING_EXTENSION');
  END IF;

  v_req_by := NULLIF(r.form_data->>'work_extend_requested_by', '');
  IF v_req_by IS NULL OR v_req_by <> v_uid::text THEN
    RETURN jsonb_build_object('error', 'NOT_REQUESTER');
  END IF;

  SELECT a.approval_version INTO v_ver
    FROM public.approvals a
   WHERE a.entity_type = 'work_permit'
     AND a.entity_id = r.id
     AND lower(COALESCE(a.position, '')) IN ('extend_cm', 'extend_sm')
     AND a.status IN ('대기', '진행중')
   ORDER BY a.approval_version DESC, a.step_order ASC
   LIMIT 1;

  IF v_ver IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_PENDING_EXTENSION');
  END IF;

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);

  UPDATE public.approvals
     SET status = '취소',
         comment = COALESCE(NULLIF(comment, ''), '신청자 철회'),
         updated_at = now()
   WHERE entity_type = 'work_permit'
     AND entity_id = r.id
     AND approval_version = v_ver
     AND status IN ('대기', '진행중')
     AND lower(COALESCE(position, '')) IN ('extend_cm', 'extend_sm');

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE public.work_permits
     SET form_data = (COALESCE(form_data, '{}'::jsonb)
          - 'work_extend_requested_until'
          - 'work_extend_requested_at'
          - 'work_extend_requested_by'
          - 'work_extend_requested_reason'),
         updated_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'extend_cancelled',
    'approval_version', v_ver,
    'cancelled_steps', v_cancelled
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.cancel_work_permit_extension(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_work_permit_extension(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.cancel_work_permit_extension(uuid) IS
  '연장 결재 신청 철회 — 신청자(work_extend_requested_by)만. 대기/진행중 extend_cm·extend_sm 취소 후 요청 필드 제거.';
