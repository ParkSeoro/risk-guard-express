CREATE OR REPLACE FUNCTION public.process_signup_company_selection(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid,
  _position text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _pos public.project_position;
  _role public.project_role;
  _became_pending boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.project_companies
    WHERE project_id = _project_id AND company_id = _company_id AND is_deleted = false
  ) THEN
    RAISE EXCEPTION '유효하지 않은 프로젝트/업체 조합입니다';
  END IF;

  _pos := public.map_signup_position(_position);
  _role := public.map_signup_position_to_role(_pos);

  IF public.is_master(_user_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE account_status = 'active') THEN
    UPDATE public.profiles SET account_status = 'active' WHERE user_id = _user_id;
    IF public.is_master(_user_id) THEN
      _role := 'project_admin'::public.project_role;
    END IF;
  ELSIF _pos = 'WORKER'::public.project_position THEN
    UPDATE public.profiles
       SET account_status = 'active'
     WHERE user_id = _user_id
       AND COALESCE(account_status, 'pending') IS DISTINCT FROM 'inactive';
  ELSE
    UPDATE public.profiles
       SET account_status = 'pending'
     WHERE user_id = _user_id
       AND COALESCE(account_status, 'pending') NOT IN ('active', 'inactive');
    _became_pending := EXISTS (
      SELECT 1 FROM public.profiles
       WHERE user_id = _user_id AND account_status = 'pending'
    );
  END IF;

  INSERT INTO public.project_members (project_id, user_id, company_id, position_new, role_new)
  VALUES (_project_id, _user_id, _company_id, _pos, _role)
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET company_id = COALESCE(EXCLUDED.company_id, public.project_members.company_id),
        role_new = CASE
          WHEN public.is_master(_user_id) THEN 'project_admin'::public.project_role
          WHEN public.project_members.role_new IN (
            'project_admin'::public.project_role,
            'safety_manager'::public.project_role,
            'site_manager'::public.project_role,
            'supervisor'::public.project_role,
            'site_supervisor'::public.project_role
          ) THEN public.project_members.role_new
          ELSE EXCLUDED.role_new
        END,
        position_new = CASE
          WHEN public.is_master(_user_id) THEN EXCLUDED.position_new
          WHEN public.project_members.role_new IN (
            'project_admin'::public.project_role,
            'safety_manager'::public.project_role,
            'site_manager'::public.project_role,
            'supervisor'::public.project_role,
            'site_supervisor'::public.project_role
          ) THEN public.project_members.position_new
          ELSE EXCLUDED.position_new
        END;

  IF _became_pending THEN
    PERFORM public.notify_owner_sm_pending_signup(_user_id, _project_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_manageable_user_auth_info()
RETURNS TABLE (
  out_user_id uuid,
  out_email text,
  out_last_sign_in_at timestamptz,
  out_email_confirmed_at timestamptz,
  out_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.role_new = 'project_admin'
    )
    OR public.is_client_owner_sm(auth.uid(), NULL)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS out_user_id,
    COALESCE(u.email, '')::text AS out_email,
    u.last_sign_in_at AS out_last_sign_in_at,
    u.email_confirmed_at AS out_email_confirmed_at,
    u.created_at AS out_created_at
  FROM auth.users u;
END;
$$;

CREATE OR REPLACE FUNCTION public.should_push_notify(_user_id uuid, _type text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p record; _is_mandatory boolean; _now_t time := (now() AT TIME ZONE 'Asia/Seoul')::time;
BEGIN
  _is_mandatory := _type IN (
    'incident','approval_request','approval_result','critical_alert','danger_zone_entry',
    'suspended_site_entry','emergency_drill','work_stop','announcement','assessment_share',
    'signup_pending'
  );
  SELECT * INTO p FROM public.notification_preferences WHERE user_id = _user_id;
  IF p IS NULL THEN RETURN true; END IF;
  IF NOT _is_mandatory AND COALESCE(p.channel_push, true) = false THEN RETURN false; END IF;
  IF NOT _is_mandatory AND p.push_quiet_start IS NOT NULL AND p.push_quiet_end IS NOT NULL THEN
    IF p.push_quiet_start < p.push_quiet_end THEN
      IF _now_t >= p.push_quiet_start AND _now_t < p.push_quiet_end THEN RETURN false; END IF;
    ELSE
      IF _now_t >= p.push_quiet_start OR _now_t < p.push_quiet_end THEN RETURN false; END IF;
    END IF;
  END IF;
  RETURN CASE _type
    WHEN 'approval_request' THEN true
    WHEN 'approval_result' THEN true
    WHEN 'danger_zone_entry' THEN true
    WHEN 'suspended_site_entry' THEN true
    WHEN 'announcement' THEN true
    WHEN 'assessment_share' THEN true
    WHEN 'signup_pending' THEN true
    WHEN 'return_request' THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection' THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit' THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm' THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning' THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due' THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident' THEN true
    WHEN 'todo_due' THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result' THEN COALESCE(p.event_assessment_result, true)
    ELSE COALESCE(p.event_general, true)
  END;
END; $function$;