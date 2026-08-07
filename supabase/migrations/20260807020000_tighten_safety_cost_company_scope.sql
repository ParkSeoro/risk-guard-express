-- 산안비 회사 격리 강화
-- master / project_admin 만 프로젝트 전 회사 열람
-- safety_manager 포함 그 외는 본인 company_id 행만 (시공사 SM도 타 협력사 불가)

CREATE OR REPLACE FUNCTION public.can_access_safety_cost(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid,
  _write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.project_role;
  _my_company uuid;
BEGIN
  IF _user_id IS NULL OR _project_id IS NULL THEN
    RETURN false;
  END IF;

  -- 플랫폼 마스터: 전역
  IF public.is_master(_user_id) THEN
    RETURN true;
  END IF;

  SELECT role_new, company_id INTO _role, _my_company
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id
  LIMIT 1;

  IF _role IS NULL THEN
    RETURN false;
  END IF;

  -- 프로젝트 관리자만 전 회사(시공사·협력사) 열람/작성
  IF _role = 'project_admin' THEN
    RETURN true;
  END IF;

  IF _write AND _role = 'viewer' THEN
    RETURN false;
  END IF;

  -- company_id 없는 orphan 행: project_admin 만 (위에서 처리됨) → 그 외 false
  IF _company_id IS NULL THEN
    RETURN false;
  END IF;

  -- 안전관리자·소장·감독 등: 소속 회사 행만
  IF _my_company IS NULL THEN
    RETURN false;
  END IF;

  RETURN _my_company = _company_id;
END;
$function$;

COMMENT ON FUNCTION public.can_access_safety_cost(uuid, uuid, uuid, boolean) IS
  'Safety cost ACL: master+project_admin = all companies; others = own company_id only.';
