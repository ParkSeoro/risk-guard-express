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

GRANT EXECUTE ON FUNCTION public.complete_worker_roster_signup(uuid, uuid, uuid, text, text, text)
  TO authenticated, service_role;
