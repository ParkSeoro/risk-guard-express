-- Day-of TBM link is execution metadata, not draft content.
-- Approved/in-approval permits must allow work_permits.tbm_session_id linkage
-- from TBM log create ("허가서에서") / permit detail CTA.

-- 1) Edit lock: do not treat tbm_session_id as locked content
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

  -- Approval / link RPCs set this for one transaction only
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

  -- Block content mutations; allow status/approval metadata (RPC)
  -- and day-of TBM link (tbm_session_id) as execution metadata.
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
  THEN
    RAISE EXCEPTION 'WORK_PERMIT_LOCKED: 결재 진행중/완료 문서는 수정할 수 없습니다. (status=%)', OLD.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Atomic 1:1 link helper (idempotent; refuses overwrite of another TBM)
CREATE OR REPLACE FUNCTION public.link_work_permit_tbm(
  _permit_id uuid,
  _tbm_session_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_permit public.work_permits%ROWTYPE;
  v_tbm public.tbm_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: 로그인이 필요합니다.' USING ERRCODE = '42501';
  END IF;

  IF _permit_id IS NULL OR _tbm_session_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGS: permit_id / tbm_session_id 가 필요합니다.';
  END IF;

  SELECT * INTO v_permit
  FROM public.work_permits
  WHERE id = _permit_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: 허가서를 찾을 수 없습니다.';
  END IF;

  IF NOT (
    public.is_master(v_uid)
    OR public.is_project_member(v_uid, v_permit.project_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: 프로젝트 권한이 없습니다.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tbm
  FROM public.tbm_sessions
  WHERE id = _tbm_session_id
    AND COALESCE(is_deleted, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: TBM 세션을 찾을 수 없습니다.';
  END IF;

  IF v_tbm.project_id IS DISTINCT FROM v_permit.project_id THEN
    RAISE EXCEPTION 'PROJECT_MISMATCH: 허가서와 TBM 프로젝트가 다릅니다.';
  END IF;

  -- Already linked
  IF v_permit.tbm_session_id IS NOT NULL THEN
    IF v_permit.tbm_session_id = _tbm_session_id THEN
      RETURN v_permit.tbm_session_id;
    END IF;
    RAISE EXCEPTION 'ALREADY_LINKED: 이 허가서에는 이미 TBM이 연결되어 있습니다.';
  END IF;

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);

  UPDATE public.work_permits
     SET tbm_session_id = _tbm_session_id,
         updated_at = now()
   WHERE id = _permit_id;

  RETURN _tbm_session_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.link_work_permit_tbm(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_work_permit_tbm(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.link_work_permit_tbm(uuid, uuid) IS
  'Link day-of TBM to work permit (1:1). Bypasses content edit lock; refuses overwrite.';
