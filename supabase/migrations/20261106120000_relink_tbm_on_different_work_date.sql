-- Final approval may point a permit at a new work-day TBM when the
-- existing link is another calendar day or already deleted.
-- The previous session stays in place so a second permit can keep it.

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
  v_old_date date;
  v_old_deleted boolean := false;
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

  IF v_permit.tbm_session_id IS NOT NULL THEN
    IF v_permit.tbm_session_id = _tbm_session_id THEN
      RETURN v_permit.tbm_session_id;
    END IF;

    SELECT s.tbm_date, COALESCE(s.is_deleted, false)
      INTO v_old_date, v_old_deleted
    FROM public.tbm_sessions s
    WHERE s.id = v_permit.tbm_session_id;

    IF NOT v_old_deleted AND v_old_date IS NOT DISTINCT FROM v_tbm.tbm_date THEN
      RAISE EXCEPTION 'ALREADY_LINKED: 이 허가서에는 이미 TBM이 연결되어 있습니다.';
    END IF;
  END IF;

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);

  UPDATE public.work_permits
     SET tbm_session_id = _tbm_session_id,
         updated_at = now()
   WHERE id = _permit_id;

  RETURN _tbm_session_id;
END;
$function$;

COMMENT ON FUNCTION public.link_work_permit_tbm(uuid, uuid) IS
  'Link a TBM to a work permit. Replaces the pointer when the existing log is another day or deleted. Does not delete the previous log.';
