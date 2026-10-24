CREATE OR REPLACE FUNCTION public.is_client_owner_sm(_user_id uuid, _project_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.project_members pm
      JOIN public.companies c ON c.id = pm.company_id
     WHERE pm.user_id = _user_id
       AND (_project_id IS NULL OR pm.project_id = _project_id)
       AND lower(COALESCE(c.type, '')) = 'client'
       AND upper(COALESCE(pm.position_new::text, '')) IN ('OWNER_SM', 'OWNER_HSE')
  );
$function$;

REVOKE ALL ON FUNCTION public.is_client_owner_sm(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_client_owner_sm(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_approve_pending_signup(_approver uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _approver IS NOT NULL AND _target IS NOT NULL AND (
    public.is_master(_approver)
    OR EXISTS (
      SELECT 1
        FROM public.project_members target_pm
        JOIN public.project_members sm_pm
          ON sm_pm.project_id = target_pm.project_id
         AND sm_pm.user_id = _approver
        JOIN public.companies c ON c.id = sm_pm.company_id
       WHERE target_pm.user_id = _target
         AND lower(COALESCE(c.type, '')) = 'client'
         AND upper(COALESCE(sm_pm.position_new::text, '')) IN ('OWNER_SM', 'OWNER_HSE')
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.can_approve_pending_signup(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_approve_pending_signup(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_owner_sm_pending_signup(_user_id uuid, _project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n int := 0;
  _name text;
  _title text := '관리자 가입 승인 요청';
  _message text;
  _link text := '/app/admin/settings/permissions?tab=pending';
BEGIN
  IF _user_id IS NULL OR _project_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), '신규 관리자')
    INTO _name
    FROM public.profiles
   WHERE user_id = _user_id;

  _message := _name || '님이 관리자 가입을 신청했습니다. 권한 관리에서 승인해 주세요.';

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT DISTINCT sm_pm.user_id, _project_id, 'signup_pending',
         _title, _message, _message, _link,
         'profile', _user_id::text, NULL, false, now()
    FROM public.project_members sm_pm
    JOIN public.companies c ON c.id = sm_pm.company_id
    JOIN public.profiles pr ON pr.user_id = sm_pm.user_id
   WHERE sm_pm.project_id = _project_id
     AND sm_pm.user_id IS DISTINCT FROM _user_id
     AND lower(COALESCE(c.type, '')) = 'client'
     AND upper(COALESCE(sm_pm.position_new::text, '')) IN ('OWNER_SM', 'OWNER_HSE')
     AND COALESCE(pr.account_status, 'active') = 'active';

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_owner_sm_pending_signup(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_owner_sm_pending_signup(uuid, uuid) TO authenticated, service_role;