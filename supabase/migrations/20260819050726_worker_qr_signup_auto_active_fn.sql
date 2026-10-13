CREATE OR REPLACE FUNCTION public.process_signup_company_selection(
  _user_id uuid, _project_id uuid, _company_id uuid, _position text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pos public.project_position;
  _role public.project_role;
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
END $$;
