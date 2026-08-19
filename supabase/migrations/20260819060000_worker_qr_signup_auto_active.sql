-- Worker QR signup: activate immediately (no admin approval).
-- Health (sensitive) consent column for PIPA Art. 23 separate checkbox.
-- Existing pending *worker-only* accounts are activated; managers stay pending.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS agreed_to_health boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.agreed_to_health IS
  '건강·민감정보 수집·이용 동의 (개인정보 보호법 제23조). 기존 이용자는 consent_agreed_at으로 통과.';

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
    -- 현장 등록 QR 근로자: 관리자 승인 없이 즉시 사용. 로그인 차단(inactive)은 유지.
    UPDATE public.profiles
       SET account_status = 'active'
     WHERE user_id = _user_id
       AND COALESCE(account_status, 'pending') IS DISTINCT FROM 'inactive';
  ELSE
    -- 이미 활성 관리자를 두 번째 프로젝트 가입으로 pending 강등하지 않음.
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

COMMENT ON FUNCTION public.process_signup_company_selection(uuid, uuid, uuid, text) IS
  'Signup/provision membership upsert. WORKER position auto-activates; preserves elevated roles.';

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

  PERFORM public.process_signup_company_selection(_user_id, _project_id, _company_id, 'WORKER');

  UPDATE public.profiles
     SET account_status = 'active'
   WHERE user_id = _user_id
     AND COALESCE(account_status, 'pending') IS DISTINCT FROM 'inactive';

  SELECT id INTO _worker_id
  FROM public.workers
  WHERE project_id = _project_id
    AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = _digits
  LIMIT 1;

  IF _worker_id IS NULL THEN
    INSERT INTO public.workers (
      project_id, name, phone, company_id, company_name, job_type, is_active, hire_date
    ) VALUES (
      _project_id,
      trim(_name),
      _digits,
      _company_id,
      coalesce(_company_name, ''),
      nullif(trim(coalesce(_job_type, '')), ''),
      true,
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

GRANT EXECUTE ON FUNCTION public.process_signup_company_selection(uuid, uuid, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_worker_roster_signup(uuid, uuid, uuid, text, text, text)
  TO authenticated, service_role;

-- Backfill: pending accounts that are workers only (no elevated project role).
UPDATE public.profiles p
   SET account_status = 'active'
 WHERE p.account_status = 'pending'
   AND NOT EXISTS (
     SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = p.user_id
        AND pm.role_new IN (
          'project_admin'::public.project_role,
          'safety_manager'::public.project_role,
          'site_manager'::public.project_role,
          'supervisor'::public.project_role,
          'site_supervisor'::public.project_role
        )
   )
   AND (
     EXISTS (
       SELECT 1 FROM public.project_members pm
        WHERE pm.user_id = p.user_id
          AND pm.position_new = 'WORKER'::public.project_position
     )
     OR EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.id = p.user_id
          AND u.email ILIKE '%@worker.local'
     )
   );
