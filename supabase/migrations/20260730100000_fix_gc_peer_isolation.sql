-- GC peer isolation: 시공사(gc) must not see other 시공사 documents.
-- Only master + 발주처(client) admins get project-wide access.
-- GC (any role including PA/SM): own company + descendants only.
-- Contractor/vendor: own only.
-- Also switch work_permits SELECT to can_access_company_data (GC was open via NOT is_contractor_user).

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
    -- Prefer project_companies parent links; fall back to companies.parent_company_id
    RETURN EXISTS (
      WITH RECURSIVE tree AS (
        SELECT pc.company_id AS id,
               COALESCE(pc.parent_company_id, c.parent_company_id) AS parent_company_id
          FROM public.project_companies pc
          LEFT JOIN public.companies c ON c.id = pc.company_id
         WHERE pc.project_id = _project_id
           AND pc.company_id = _own_company
           AND COALESCE(pc.is_deleted, false) = false
        UNION
        SELECT c.id, c.parent_company_id
          FROM public.companies c
         WHERE c.id = _own_company
        UNION ALL
        SELECT pc.company_id,
               COALESCE(pc.parent_company_id, c.parent_company_id)
          FROM public.project_companies pc
          LEFT JOIN public.companies c ON c.id = pc.company_id
          JOIN tree t ON COALESCE(pc.parent_company_id, c.parent_company_id) = t.id
         WHERE pc.project_id = _project_id
           AND COALESCE(pc.is_deleted, false) = false
        UNION ALL
        SELECT c.id, c.parent_company_id
          FROM public.companies c
          JOIN tree t ON c.parent_company_id = t.id
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

-- work_permits: use can_access_company_data so GC peers are blocked
DROP POLICY IF EXISTS "Members can view work_permits" ON public.work_permits;
CREATE POLICY "Members can view work_permits"
  ON public.work_permits
  FOR SELECT
  TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND (
      created_by = auth.uid()
      OR (
        company_id IS NOT NULL
        AND public.can_access_company_data(auth.uid(), project_id, company_id)
      )
      OR (
        company_id IS NULL
        AND (
          public.is_master(auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.project_members pm
            JOIN public.companies c ON c.id = pm.company_id
            WHERE pm.user_id = auth.uid()
              AND pm.project_id = work_permits.project_id
              AND lower(trim(COALESCE(c.type, ''))) IN ('client', '발주처', 'owner')
              AND pm.role_new IN ('project_admin', 'safety_manager', 'site_manager', 'supervisor', 'site_supervisor')
          )
        )
      )
    )
    AND (
      status IS NULL
      OR status NOT IN ('작성중', '임시저장', '반려')
      OR created_by = auth.uid()
      OR public.is_master(auth.uid())
      OR public.is_project_admin(auth.uid(), project_id)
      OR (
        status = '반려'
        AND EXISTS (
          SELECT 1
          FROM public.approvals a
          WHERE a.entity_type = 'work_permit'
            AND a.entity_id = work_permits.id
            AND a.approver_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Members can update work_permits" ON public.work_permits;
CREATE POLICY "Members can update work_permits"
  ON public.work_permits
  FOR UPDATE
  TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND (
      created_by = auth.uid()
      OR public.is_master(auth.uid())
      OR (
        company_id IS NOT NULL
        AND public.can_access_company_data(auth.uid(), project_id, company_id)
      )
    )
  );

-- Align workers policy helper usage already on can_access_company_data — function update is enough.

GRANT EXECUTE ON FUNCTION public.can_access_company_data(uuid, uuid, uuid) TO authenticated, service_role;

-- Writers: GC PA must not write peer GC rows (align with can_access)
CREATE OR REPLACE FUNCTION public.can_write_company_data(
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
        AND public.has_project_role(
          _user_id,
          pc.project_id,
          ARRAY['project_admin', 'safety_manager']::public.project_role[]
        )
        AND public.can_access_company_data(_user_id, pc.project_id, _company_id)
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
  IF _role IN ('viewer', 'worker') THEN
    RETURN false;
  END IF;

  -- Must be able to read the company scope first (blocks GC peer / contractor overreach)
  IF NOT public.can_access_company_data(_user_id, _project_id, _company_id) THEN
    RETURN false;
  END IF;

  -- 발주처 admin/supervisor: project-wide write (can_access already true)
  IF _own_type IN ('client', '발주처', 'owner')
     AND _role IN ('project_admin', 'safety_manager', 'site_manager', 'supervisor', 'site_supervisor') THEN
    RETURN true;
  END IF;

  -- 시공사 / 협력사: PA/SM/SM/supervisor may write within can_access tree/own
  IF _role IN ('project_admin', 'safety_manager', 'site_manager', 'supervisor', 'site_supervisor') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.can_write_company_data(uuid, uuid, uuid) TO authenticated, service_role;
