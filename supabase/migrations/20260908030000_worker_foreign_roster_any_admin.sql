-- 이관: 대상 회사 현장대리인만이 아니라 현장 관리자 전원
-- (project_admin / safety_manager / site_manager / supervisor / site_supervisor / master)

CREATE OR REPLACE FUNCTION public.list_foreign_company_roster_workers(
  _project_id uuid,
  _company_id uuid
)
RETURNS TABLE (
  worker_id uuid,
  name text,
  phone text,
  job_type text,
  is_active boolean,
  source_company_id uuid,
  source_company_name text,
  login_company_id uuid,
  login_company_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR _project_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.has_project_role(
    v_uid,
    _project_id,
    ARRAY[
      'project_admin',
      'safety_manager',
      'site_manager',
      'supervisor',
      'site_supervisor'
    ]::public.project_role[]
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    w.id,
    w.name,
    w.phone,
    w.job_type,
    COALESCE(w.is_active, true),
    w.company_id,
    COALESCE(src.name, w.company_name),
    pm.company_id,
    dest.name
  FROM public.workers w
  JOIN public.profiles pr
    ON public.normalize_phone_digits(pr.phone) = public.normalize_phone_digits(w.phone)
   AND public.normalize_phone_digits(COALESCE(w.phone, '')) <> ''
  JOIN public.project_members pm
    ON pm.user_id = pr.user_id
   AND pm.project_id = w.project_id
  LEFT JOIN public.companies src ON src.id = w.company_id
  LEFT JOIN public.companies dest ON dest.id = pm.company_id
  WHERE w.project_id = _project_id
    AND (_company_id IS NULL OR pm.company_id = _company_id)
    AND w.company_id IS DISTINCT FROM pm.company_id
  ORDER BY w.name, w.created_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_foreign_company_roster_workers(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_foreign_company_roster_workers(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transfer_worker_company(
  _worker_id uuid,
  _to_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_worker public.workers%ROWTYPE;
  v_to_name text;
  v_has_login boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인이 필요합니다');
  END IF;
  IF _worker_id IS NULL OR _to_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ARGS');
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_worker.company_id IS NOT DISTINCT FROM _to_company_id
     AND COALESCE(v_worker.is_active, true) = true THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  IF NOT public.has_project_role(
    v_uid,
    v_worker.project_id,
    ARRAY[
      'project_admin',
      'safety_manager',
      'site_manager',
      'supervisor',
      'site_supervisor'
    ]::public.project_role[]
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', '관리자만 이관할 수 있습니다');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.project_members pm
      ON pm.user_id = pr.user_id
     AND pm.project_id = v_worker.project_id
    WHERE public.normalize_phone_digits(pr.phone) = public.normalize_phone_digits(v_worker.phone)
      AND public.normalize_phone_digits(COALESCE(v_worker.phone, '')) <> ''
      AND pm.company_id = _to_company_id
  ) INTO v_has_login;

  IF NOT v_has_login THEN
    RETURN jsonb_build_object('ok', false, 'error', '해당 회사 로그인 계정이 없습니다');
  END IF;

  SELECT name INTO v_to_name FROM public.companies WHERE id = _to_company_id;

  UPDATE public.workers
     SET company_id = _to_company_id,
         company_name = COALESCE(NULLIF(btrim(v_to_name), ''), company_name),
         is_active = true,
         updated_at = now()
   WHERE id = _worker_id;

  RETURN jsonb_build_object(
    'ok', true,
    'worker_id', _worker_id,
    'from_company_id', v_worker.company_id,
    'to_company_id', _to_company_id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.transfer_worker_company(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_worker_company(uuid, uuid) TO authenticated, service_role;
