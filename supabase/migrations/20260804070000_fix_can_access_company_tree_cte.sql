-- Fix invalid recursive CTE in can_access_company_data.
-- PG error: recursive reference to query "tree" must not appear within its non-recursive term
-- Cause: multiple UNION/UNION ALL with tree self-refs (ambiguous recursive boundary).
-- Approvals SELECT RLS calls this → mobile "결재 이력 로드 실패".

CREATE OR REPLACE FUNCTION public.can_access_company_data(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.project_role;
  _own_company uuid;
  _own_type text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_master(_user_id) THEN
    RETURN true;
  END IF;

  IF _project_id IS NULL THEN
    IF _company_id IS NULL THEN
      RETURN false;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.project_companies pc
      WHERE pc.company_id = _company_id
        AND COALESCE(pc.is_deleted, false) = false
        AND public.is_project_member(_user_id, pc.project_id)
    );
  END IF;

  SELECT pm.role_new, pm.company_id, lower(trim(COALESCE(c.type, '')))
    INTO _role, _own_company, _own_type
  FROM public.project_members pm
  LEFT JOIN public.companies c ON c.id = pm.company_id
  WHERE pm.user_id = _user_id AND pm.project_id = _project_id
  LIMIT 1;

  IF _role IS NULL THEN
    RETURN false;
  END IF;

  -- 협력사 / 공급사: 자사만
  IF _own_type IN (
    'contractor', 'vendor',
    '협력사', '하청', 'subcontractor',
    '공급사', '납품사'
  ) THEN
    IF _own_company IS NULL OR _company_id IS NULL THEN
      RETURN false;
    END IF;
    RETURN _company_id = _own_company;
  END IF;

  -- 시공사(gc): 자사 + 하위만 (PA/SM 포함 — 타 시공사 불가)
  IF _own_type IN ('gc', '시공사', '원도급', '원청', 'general_contractor') THEN
    IF _own_company IS NULL OR _company_id IS NULL THEN
      RETURN false;
    END IF;
    IF _company_id = _own_company THEN
      RETURN true;
    END IF;
    -- Valid recursive CTE: one non-recursive seed + one recursive step
    -- (children via project_companies parent OR companies.parent_company_id)
    RETURN EXISTS (
      WITH RECURSIVE tree AS (
        SELECT _own_company AS id
        UNION ALL
        SELECT child.id
        FROM (
          SELECT pc.company_id AS id,
                 COALESCE(pc.parent_company_id, c.parent_company_id) AS parent_id
            FROM public.project_companies pc
            LEFT JOIN public.companies c ON c.id = pc.company_id
           WHERE pc.project_id = _project_id
             AND COALESCE(pc.is_deleted, false) = false
          UNION
          SELECT c2.id, c2.parent_company_id AS parent_id
            FROM public.companies c2
        ) child
        JOIN tree t ON child.parent_id = t.id
        WHERE child.id IS NOT NULL
          AND child.id <> t.id
      )
      SELECT 1 FROM tree WHERE id = _company_id
    );
  END IF;

  -- 발주처(client) PA/SM: 프로젝트 전체
  IF _own_type IN ('client', '발주처', 'owner')
     AND _role IN ('project_admin', 'safety_manager') THEN
    RETURN true;
  END IF;

  -- 발주처 site_manager/supervisor: 프로젝트 전체 (발주 감독)
  IF _own_type IN ('client', '발주처', 'owner')
     AND _role IN ('site_manager', 'supervisor', 'site_supervisor') THEN
    RETURN true;
  END IF;

  IF _company_id IS NULL OR _own_company IS NULL THEN
    RETURN false;
  END IF;

  IF _company_id = _own_company THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.can_access_company_data(uuid, uuid, uuid) TO authenticated, service_role;
