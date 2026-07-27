-- Map legacy Auth UI position strings → project_position enum
-- and activate first master / empty-system signup.

CREATE OR REPLACE FUNCTION public.map_signup_position(_raw text)
RETURNS public.project_position
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(_raw, ''))
    WHEN 'site_manager' THEN 'SITE_MANAGER'::public.project_position
    WHEN 'safety_manager' THEN 'HSE_MANAGER'::public.project_position
    WHEN 'supervisor' THEN 'SUPERVISOR'::public.project_position
    WHEN 'foreman' THEN 'FOREMAN'::public.project_position
    WHEN 'worker' THEN 'WORKER'::public.project_position
    WHEN 'inspector' THEN 'SUPERVISOR'::public.project_position
    WHEN 'other' THEN 'WORKER'::public.project_position
    WHEN 'site_manager'::text THEN 'SITE_MANAGER'::public.project_position
    ELSE
      CASE
        WHEN upper(_raw) IN (
          'SITE_MANAGER','HSE_MANAGER','CONSTRUCTION_MGR','FIELD_ENGINEER',
          'FOREMAN','WORKER','OWNER_PM','OWNER_HSE','SUPERVISOR','CEO','EXECUTIVE'
        ) THEN upper(_raw)::public.project_position
        ELSE 'WORKER'::public.project_position
      END
  END;
$$;

CREATE OR REPLACE FUNCTION public.process_signup_company_selection(
  _user_id uuid, _project_id uuid, _company_id uuid, _position text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pos public.project_position;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.project_companies
                 WHERE project_id = _project_id AND company_id = _company_id AND is_deleted = false) THEN
    RAISE EXCEPTION '유효하지 않은 프로젝트/업체 조합입니다';
  END IF;

  _pos := public.map_signup_position(_position);

  IF public.is_master(_user_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE account_status = 'active') THEN
    UPDATE public.profiles SET account_status = 'active' WHERE user_id = _user_id;
  ELSE
    UPDATE public.profiles SET account_status = 'pending' WHERE user_id = _user_id;
  END IF;

  INSERT INTO public.project_members (project_id, user_id, company_id, position_new, role_new)
  VALUES (
    _project_id,
    _user_id,
    _company_id,
    _pos,
    CASE WHEN public.is_master(_user_id) THEN 'project_admin'::public.project_role
         ELSE 'viewer'::public.project_role END
  )
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        position_new = EXCLUDED.position_new,
        role_new = CASE
          WHEN public.is_master(_user_id) THEN 'project_admin'::public.project_role
          ELSE public.project_members.role_new
        END;
END $$;

GRANT EXECUTE ON FUNCTION public.map_signup_position(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_signup_company_selection(uuid, uuid, uuid, text) TO anon, authenticated, service_role;
