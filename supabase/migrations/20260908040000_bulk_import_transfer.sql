-- Excel 일괄등록 미리보기에서 타사 명단을 이관할 수 있게 worker_id를 돌려준다.
-- 대상 회사 관리자는 로그인 계정이 없어도 명단 소속을 옮길 수 있다.

DROP FUNCTION IF EXISTS public.list_project_worker_phone_hits(uuid, text[]);

CREATE FUNCTION public.list_project_worker_phone_hits(
  _project_id uuid,
  _phones text[]
)
RETURNS TABLE (
  phone_digits text,
  company_id uuid,
  company_name text,
  worker_id uuid,
  is_active boolean
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
  IF NOT (
    public.is_master(v_uid)
    OR public.is_project_member(v_uid, _project_id)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    public.normalize_phone_digits(w.phone),
    w.company_id,
    COALESCE(src.name, w.company_name),
    w.id,
    COALESCE(w.is_active, true)
  FROM public.workers w
  LEFT JOIN public.companies src ON src.id = w.company_id
  WHERE w.project_id = _project_id
    AND public.normalize_phone_digits(w.phone) = ANY (
      SELECT public.normalize_phone_digits(p)
      FROM unnest(COALESCE(_phones, ARRAY[]::text[])) AS p
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_project_worker_phone_hits(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_project_worker_phone_hits(uuid, text[]) TO authenticated, service_role;

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
  v_can_write_dest boolean := false;
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

  IF NOT (
    public.is_master(v_uid)
    OR public.has_project_role(
      v_uid,
      v_worker.project_id,
      ARRAY[
        'project_admin',
        'safety_manager',
        'site_manager',
        'supervisor',
        'site_supervisor'
      ]::public.project_role[]
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', '관리자만 이관할 수 있습니다');
  END IF;

  v_can_write_dest := public.is_master(v_uid)
    OR public.can_write_company_data(v_uid, v_worker.project_id, _to_company_id);

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

  IF NOT v_has_login AND NOT v_can_write_dest THEN
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
