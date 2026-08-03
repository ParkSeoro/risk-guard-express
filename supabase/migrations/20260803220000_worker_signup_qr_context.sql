-- Q4: position → role_new on signup (was hard-coded viewer)
-- Worker roster: create workers row at signup (등록대기 via profiles.account_status)

CREATE OR REPLACE FUNCTION public.map_signup_position(_raw text)
RETURNS public.project_position
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(_raw, ''))
    WHEN 'site_manager' THEN 'SITE_MANAGER'::public.project_position
    WHEN 'safety_manager' THEN 'HSE_MANAGER'::public.project_position
    WHEN 'supervisor' THEN 'SUPERVISOR'::public.project_position
    WHEN 'site_supervisor' THEN 'SITE_SUPERVISOR'::public.project_position
    WHEN 'foreman' THEN 'FOREMAN'::public.project_position
    WHEN 'worker' THEN 'WORKER'::public.project_position
    WHEN 'inspector' THEN 'SUPERVISOR'::public.project_position
    WHEN 'other' THEN 'WORKER'::public.project_position
    ELSE
      CASE
        WHEN upper(coalesce(_raw, '')) IN (
          'SITE_MANAGER','HSE_MANAGER','CONSTRUCTION_MGR','FIELD_ENGINEER',
          'FOREMAN','WORKER','OWNER_PM','OWNER_CM','OWNER_SM','OWNER_HSE',
          'SUPERVISOR','SITE_SUPERVISOR','CEO','EXECUTIVE'
        ) THEN upper(_raw)::public.project_position
        ELSE 'WORKER'::public.project_position
      END
  END;
$$;

-- Mirror src/lib/projectPositions.ts defaultRoleForPosition
CREATE OR REPLACE FUNCTION public.map_signup_position_to_role(_pos public.project_position)
RETURNS public.project_role
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _pos
    WHEN 'OWNER_PM' THEN 'project_admin'::public.project_role
    WHEN 'OWNER_CM' THEN 'project_admin'::public.project_role
    WHEN 'CEO' THEN 'project_admin'::public.project_role
    WHEN 'EXECUTIVE' THEN 'project_admin'::public.project_role
    WHEN 'OWNER_SM' THEN 'safety_manager'::public.project_role
    WHEN 'OWNER_HSE' THEN 'safety_manager'::public.project_role
    WHEN 'HSE_MANAGER' THEN 'safety_manager'::public.project_role
    WHEN 'SITE_MANAGER' THEN 'site_manager'::public.project_role
    WHEN 'CONSTRUCTION_MGR' THEN 'site_manager'::public.project_role
    WHEN 'SUPERVISOR' THEN 'supervisor'::public.project_role
    WHEN 'SITE_SUPERVISOR' THEN 'site_supervisor'::public.project_role
    WHEN 'FOREMAN' THEN 'worker'::public.project_role
    WHEN 'FIELD_ENGINEER' THEN 'worker'::public.project_role
    WHEN 'WORKER' THEN 'worker'::public.project_role
    ELSE 'viewer'::public.project_role
  END;
$$;

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
  ELSE
    UPDATE public.profiles SET account_status = 'pending' WHERE user_id = _user_id;
  END IF;

  INSERT INTO public.project_members (project_id, user_id, company_id, position_new, role_new)
  VALUES (_project_id, _user_id, _company_id, _pos, _role)
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        position_new = EXCLUDED.position_new,
        role_new = CASE
          WHEN public.is_master(_user_id) THEN 'project_admin'::public.project_role
          ELSE EXCLUDED.role_new
        END;
END $$;

-- After Auth signup: upsert workers roster row (등록대기 = profiles.pending)
CREATE OR REPLACE FUNCTION public.complete_worker_roster_signup(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid,
  _name text,
  _phone text,
  _job_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_name text;
  _digits text;
  _worker_id uuid;
  _qr text;
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM _user_id
     AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.project_companies
    WHERE project_id = _project_id AND company_id = _company_id AND is_deleted = false
  ) THEN
    RETURN jsonb_build_object('error', '유효하지 않은 프로젝트/업체');
  END IF;

  SELECT c.name INTO _company_name FROM public.companies c WHERE c.id = _company_id;
  _digits := regexp_replace(coalesce(_phone, ''), '\D', '', 'g');
  IF length(_digits) < 9 OR length(trim(coalesce(_name, ''))) < 1 THEN
    RETURN jsonb_build_object('error', '이름·전화번호가 올바르지 않습니다');
  END IF;

  -- Ensure membership (WORKER → role worker)
  PERFORM public.process_signup_company_selection(_user_id, _project_id, _company_id, 'WORKER');

  SELECT id INTO _worker_id
  FROM public.workers
  WHERE project_id = _project_id
    AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = _digits
  LIMIT 1;

  IF _worker_id IS NULL THEN
    _qr := encode(gen_random_bytes(16), 'hex');
    INSERT INTO public.workers (
      project_id, name, phone, company_id, company_name, job_type, is_active, qr_token, hire_date
    ) VALUES (
      _project_id,
      trim(_name),
      _digits,
      _company_id,
      coalesce(_company_name, ''),
      nullif(trim(coalesce(_job_type, '')), ''),
      true,
      _qr,
      CURRENT_DATE
    )
    RETURNING id INTO _worker_id;
  ELSE
    UPDATE public.workers
    SET name = trim(_name),
        company_id = _company_id,
        company_name = coalesce(_company_name, company_name),
        job_type = coalesce(nullif(trim(coalesce(_job_type, '')), ''), job_type),
        is_active = true
    WHERE id = _worker_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'worker_id', _worker_id);
END $$;

GRANT EXECUTE ON FUNCTION public.map_signup_position_to_role(public.project_position) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_signup_company_selection(uuid, uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_worker_roster_signup(uuid, uuid, uuid, text, text, text) TO authenticated, service_role;
