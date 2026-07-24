CREATE OR REPLACE FUNCTION public.approve_pending_user(
  _user_id uuid,
  _override_role public.project_role DEFAULT NULL::public.project_role
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_admin boolean;
  _mem RECORD;
  _mapped public.project_role;
  _touched int := 0;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT (
    public.is_master(_caller)
    OR EXISTS (
      SELECT 1
      FROM public.project_members
      WHERE user_id = _caller
        AND role_new = 'project_admin'::public.project_role
    )
  ) INTO _is_admin;

  IF NOT _is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.profiles
     SET account_status = 'active',
         updated_at = now()
   WHERE user_id = _user_id;

  FOR _mem IN
    SELECT id, position_new, role_new
    FROM public.project_members
    WHERE user_id = _user_id
  LOOP
    _mapped := COALESCE(
      _override_role,
      CASE
        WHEN _mem.position_new::text IN ('site_manager', 'safety_manager', 'HSE_MANAGER', 'SITE_MANAGER')
          THEN 'safety_manager'::public.project_role
        WHEN _mem.position_new::text IN ('inspector', 'SUPERVISOR')
          THEN 'supervisor'::public.project_role
        ELSE 'viewer'::public.project_role
      END
    );

    IF _override_role IS NOT NULL
       OR _mem.role_new IS NULL
       OR _mem.role_new = 'viewer'::public.project_role THEN
      UPDATE public.project_members
         SET role_new = _mapped
       WHERE id = _mem.id;
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

REVOKE ALL ON FUNCTION public.approve_pending_user(uuid, public.project_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_pending_user(uuid, public.project_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_pending_user(
  _user_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_admin boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT (
    public.is_master(_caller)
    OR EXISTS (
      SELECT 1
      FROM public.project_members
      WHERE user_id = _caller
        AND role_new = 'project_admin'::public.project_role
    )
  ) INTO _is_admin;

  IF NOT _is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.profiles
     SET account_status = 'inactive',
         updated_at = now()
   WHERE user_id = _user_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    _caller,
    (SELECT display_name FROM public.profiles WHERE user_id = _caller),
    '가입반려',
    'profile',
    _user_id::text,
    jsonb_build_object('reason', _reason)
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_pending_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_pending_user(uuid, text) TO authenticated;