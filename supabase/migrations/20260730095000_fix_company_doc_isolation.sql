-- Fix cross-company document visibility for contractors/vendors.
-- 1) is_contractor_user: treat contractor + vendor (+ Korean aliases) as subordinate
-- 2) can_access_company_data: subordinate company members only see own company
--    (never full project via PA/SM role on a contractor company)
-- 3) work_permit_workers: inherit parent permit company scope

CREATE OR REPLACE FUNCTION public.is_contractor_user(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    JOIN public.companies c ON c.id = pm.company_id
    WHERE pm.user_id = _user_id
      AND pm.project_id = _project_id
      AND lower(trim(COALESCE(c.type, ''))) IN (
        'contractor', 'vendor',
        '협력사', '하청', 'subcontractor',
        '공급사', '납품사'
      )
  );
$$;

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

  -- Global / system company: grant access if user is a member of any linked project
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

  -- Subordinate companies (협력사/공급사): own company only — no PA/SM project-wide bypass
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

  -- Owner-side (client/gc) admins: full project
  IF _role IN ('project_admin', 'safety_manager') THEN
    RETURN true;
  END IF;

  IF _company_id IS NULL OR _own_company IS NULL THEN
    RETURN false;
  END IF;

  IF _company_id = _own_company THEN
    RETURN true;
  END IF;

  -- GC/client site managers: own + descendant companies
  IF _role IN ('site_manager', 'supervisor', 'site_supervisor') THEN
    RETURN EXISTS (
      WITH RECURSIVE tree AS (
        SELECT id, parent_company_id
          FROM public.companies
         WHERE id = _own_company
        UNION ALL
        SELECT c.id, c.parent_company_id
          FROM public.companies c
          JOIN tree t ON c.parent_company_id = t.id
      )
      SELECT 1 FROM tree WHERE id = _company_id
    );
  END IF;

  RETURN false;
END;
$function$;

-- work_permit_workers: contractors only see assignments on their company's permits
DROP POLICY IF EXISTS "wpw_select" ON public.work_permit_workers;
DROP POLICY IF EXISTS "Members can view work_permit_workers" ON public.work_permit_workers;
DROP POLICY IF EXISTS "Project members can view work_permit_workers" ON public.work_permit_workers;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'work_permit_workers'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Members can view work_permit_workers"
        ON public.work_permit_workers
        FOR SELECT
        TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.work_permits wp
            WHERE wp.id = work_permit_workers.permit_id
              AND public.is_project_member(auth.uid(), wp.project_id)
              AND (
                NOT public.is_contractor_user(auth.uid(), wp.project_id)
                OR wp.company_id = public.get_user_company_id(auth.uid(), wp.project_id)
                OR wp.created_by = auth.uid()
              )
          )
        )
    $pol$;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.is_contractor_user(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_company_data(uuid, uuid, uuid) TO authenticated, service_role;
