
CREATE OR REPLACE FUNCTION public.approve_pending_user(
  _user_id uuid,
  _override_role project_role DEFAULT NULL::project_role
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_admin boolean;
  _mem RECORD;
  _mapped project_role;
  _touched int := 0;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT (public.has_role(_caller, 'master'::global_role)
          OR EXISTS (SELECT 1 FROM public.project_members
                     WHERE user_id = _caller AND role_new = 'project_admin'::project_role))
  INTO _is_admin;

  IF NOT _is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.profiles
     SET account_status = 'active'
   WHERE user_id = _user_id;

  FOR _mem IN SELECT id, position_new, role_new FROM public.project_members WHERE user_id = _user_id LOOP
    _mapped := COALESCE(
      _override_role,
      CASE
        WHEN _mem.position_new::text IN ('site_manager','safety_manager','HSE_MANAGER','SITE_MANAGER')
          THEN 'safety_manager'::project_role
        WHEN _mem.position_new::text IN ('inspector','SUPERVISOR')
          THEN 'supervisor'::project_role
        ELSE 'viewer'::project_role
      END
    );
    IF _override_role IS NOT NULL
       OR _mem.role_new IS NULL
       OR _mem.role_new = 'viewer'::project_role THEN
      UPDATE public.project_members SET role_new = _mapped WHERE id = _mem.id;
      _touched := _touched + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    _caller,
    (SELECT display_name FROM public.profiles WHERE user_id = _caller),
    '가입승인',
    'profile',
    _user_id::text,
    jsonb_build_object('memberships_updated', _touched, 'override_role', _override_role)
  );

  RETURN jsonb_build_object('ok', true, 'memberships_updated', _touched);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.approve_pending_user(uuid, project_role) TO authenticated;
