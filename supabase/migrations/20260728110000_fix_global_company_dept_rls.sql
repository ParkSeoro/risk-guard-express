-- Fix: global companies (project_id IS NULL) blocked department/manager writes
-- even for masters, because can_* helpers returned false before is_master check.
-- Also allow PA/SM/members via project_companies linkage.

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
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Masters always allowed (including global companies with null project_id)
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

  SELECT role_new, company_id
    INTO _role, _own_company
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id
  LIMIT 1;

  IF _role IS NULL THEN
    RETURN false;
  END IF;

  IF _role IN ('project_admin', 'safety_manager') THEN
    RETURN true;
  END IF;

  IF _company_id IS NULL OR _own_company IS NULL THEN
    RETURN false;
  END IF;

  IF _company_id = _own_company THEN
    RETURN true;
  END IF;

  IF _role IN ('site_manager', 'supervisor') THEN
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
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Masters always allowed (including global companies with null project_id)
  IF public.is_master(_user_id) THEN
    RETURN true;
  END IF;

  -- Global / system company: PA/SM on any linked project may write
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
    );
  END IF;

  SELECT role_new, company_id
    INTO _role, _own_company
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id
  LIMIT 1;

  IF _role IS NULL THEN
    RETURN false;
  END IF;
  IF _role IN ('viewer', 'worker') THEN
    RETURN false;
  END IF;

  IF _role IN ('project_admin', 'safety_manager') THEN
    RETURN true;
  END IF;

  IF _company_id IS NULL OR _own_company IS NULL THEN
    RETURN false;
  END IF;
  IF _company_id = _own_company THEN
    RETURN true;
  END IF;

  IF _role IN ('site_manager', 'supervisor') THEN
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

-- company_departments SELECT previously required is_project_member(c.project_id),
-- which always fails when project_id is NULL. Rely on can_access_company_data.
DROP POLICY IF EXISTS "view company departments" ON public.company_departments;
CREATE POLICY "view company departments"
  ON public.company_departments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_departments.company_id
        AND public.can_access_company_data(auth.uid(), c.project_id, c.id)
    )
  );

DROP POLICY IF EXISTS "write company departments" ON public.company_departments;
CREATE POLICY "write company departments"
  ON public.company_departments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_departments.company_id
        AND public.can_write_company_data(auth.uid(), c.project_id, c.id)
    )
  );

DROP POLICY IF EXISTS "update company departments" ON public.company_departments;
CREATE POLICY "update company departments"
  ON public.company_departments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_departments.company_id
        AND public.can_write_company_data(auth.uid(), c.project_id, c.id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_departments.company_id
        AND public.can_write_company_data(auth.uid(), c.project_id, c.id)
    )
  );

DROP POLICY IF EXISTS "delete company departments" ON public.company_departments;
CREATE POLICY "delete company departments"
  ON public.company_departments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_departments.company_id
        AND public.can_write_company_data(auth.uid(), c.project_id, c.id)
    )
  );

-- Same SELECT fix for company_managers
DROP POLICY IF EXISTS "view company managers" ON public.company_managers;
CREATE POLICY "view company managers"
  ON public.company_managers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_managers.company_id
        AND public.can_access_company_data(auth.uid(), c.project_id, c.id)
    )
  );
