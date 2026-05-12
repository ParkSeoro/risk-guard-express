
-- Helper: write permission with company tree isolation
CREATE OR REPLACE FUNCTION public.can_write_company_data(_user_id uuid, _project_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _role public.project_role;
  _own_company uuid;
BEGIN
  IF _user_id IS NULL OR _project_id IS NULL THEN RETURN false; END IF;

  IF public.is_master(_user_id) THEN RETURN true; END IF;

  SELECT role_new, company_id INTO _role, _own_company
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id LIMIT 1;

  IF _role IS NULL THEN RETURN false; END IF;
  IF _role IN ('viewer','worker') THEN RETURN false; END IF;

  -- Full-access roles can write anywhere in project, including company_id NULL
  IF _role IN ('project_admin','safety_manager') THEN RETURN true; END IF;

  -- Restricted roles need a company target
  IF _company_id IS NULL OR _own_company IS NULL THEN RETURN false; END IF;
  IF _company_id = _own_company THEN RETURN true; END IF;

  IF _role IN ('site_manager','supervisor') THEN
    RETURN EXISTS (
      WITH RECURSIVE tree AS (
        SELECT id, parent_company_id FROM public.companies WHERE id = _own_company
        UNION ALL
        SELECT c.id, c.parent_company_id FROM public.companies c
        JOIN tree t ON c.parent_company_id = t.id
      )
      SELECT 1 FROM tree WHERE id = _company_id
    );
  END IF;

  RETURN false;
END;
$$;

-- work_plans
DROP POLICY IF EXISTS "Members can insert work plans" ON public.work_plans;
DROP POLICY IF EXISTS "Members can update work plans" ON public.work_plans;
DROP POLICY IF EXISTS "Admins can delete work plans" ON public.work_plans;
CREATE POLICY "Writers can insert work plans" ON public.work_plans FOR INSERT WITH CHECK (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can update work plans" ON public.work_plans FOR UPDATE USING (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can delete work plans" ON public.work_plans FOR DELETE USING (can_write_company_data(auth.uid(), project_id, company_id));

-- tbm_sessions
DROP POLICY IF EXISTS "Members can insert tbm_sessions" ON public.tbm_sessions;
DROP POLICY IF EXISTS "Members can update tbm_sessions" ON public.tbm_sessions;
DROP POLICY IF EXISTS "Admins can delete tbm_sessions" ON public.tbm_sessions;
CREATE POLICY "Writers can insert tbm_sessions" ON public.tbm_sessions FOR INSERT WITH CHECK (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can update tbm_sessions" ON public.tbm_sessions FOR UPDATE USING (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can delete tbm_sessions" ON public.tbm_sessions FOR DELETE USING (can_write_company_data(auth.uid(), project_id, company_id));

-- safety_inspections
DROP POLICY IF EXISTS "Members can insert inspections" ON public.safety_inspections;
DROP POLICY IF EXISTS "Members can update inspections" ON public.safety_inspections;
DROP POLICY IF EXISTS "Admins can delete inspections" ON public.safety_inspections;
CREATE POLICY "Writers can insert inspections" ON public.safety_inspections FOR INSERT WITH CHECK (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can update inspections" ON public.safety_inspections FOR UPDATE USING (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can delete inspections" ON public.safety_inspections FOR DELETE USING (can_write_company_data(auth.uid(), project_id, company_id));

-- equipment_master
DROP POLICY IF EXISTS "Members can insert equipment" ON public.equipment_master;
DROP POLICY IF EXISTS "Members can update equipment" ON public.equipment_master;
DROP POLICY IF EXISTS "Admins can delete equipment" ON public.equipment_master;
CREATE POLICY "Writers can insert equipment" ON public.equipment_master FOR INSERT WITH CHECK (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can update equipment" ON public.equipment_master FOR UPDATE USING (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can delete equipment" ON public.equipment_master FOR DELETE USING (can_write_company_data(auth.uid(), project_id, company_id));

-- legal_duties
DROP POLICY IF EXISTS "Members can insert legal duties" ON public.legal_duties;
DROP POLICY IF EXISTS "Members can update legal duties" ON public.legal_duties;
DROP POLICY IF EXISTS "Admins can delete legal duties" ON public.legal_duties;
CREATE POLICY "Writers can insert legal duties" ON public.legal_duties FOR INSERT WITH CHECK (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can update legal duties" ON public.legal_duties FOR UPDATE USING (can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can delete legal duties" ON public.legal_duties FOR DELETE USING (can_write_company_data(auth.uid(), project_id, company_id));

-- company_construction_info (company_id reference is the row itself)
DROP POLICY IF EXISTS "Members can insert construction info" ON public.company_construction_info;
DROP POLICY IF EXISTS "Members can update construction info" ON public.company_construction_info;
DROP POLICY IF EXISTS "Admins can delete construction info" ON public.company_construction_info;
CREATE POLICY "Writers can insert construction info" ON public.company_construction_info FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND can_write_company_data(auth.uid(), c.project_id, c.id))
);
CREATE POLICY "Writers can update construction info" ON public.company_construction_info FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND can_write_company_data(auth.uid(), c.project_id, c.id))
);
CREATE POLICY "Writers can delete construction info" ON public.company_construction_info FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND can_write_company_data(auth.uid(), c.project_id, c.id))
);

-- approvals (company_id may be NULL = cross-company doc; only admin/safety_manager can write those)
DROP POLICY IF EXISTS "Members can insert approvals" ON public.approvals;
DROP POLICY IF EXISTS "Members can update approvals" ON public.approvals;
CREATE POLICY "Writers can insert approvals" ON public.approvals FOR INSERT WITH CHECK (
  is_project_member(auth.uid(), project_id) AND (
    company_id IS NULL AND has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
    OR can_write_company_data(auth.uid(), project_id, company_id)
  )
);
CREATE POLICY "Writers can update approvals" ON public.approvals FOR UPDATE USING (
  is_project_member(auth.uid(), project_id) AND (
    company_id IS NULL AND has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
    OR can_write_company_data(auth.uid(), project_id, company_id)
  )
);

-- approval_lines (no company_id col on this table — admins/safety_manager only)
DROP POLICY IF EXISTS "Admins can insert approval lines" ON public.approval_lines;
DROP POLICY IF EXISTS "Admins can update approval lines" ON public.approval_lines;
DROP POLICY IF EXISTS "Admins can delete approval lines" ON public.approval_lines;
CREATE POLICY "Admins can insert approval lines" ON public.approval_lines FOR INSERT WITH CHECK (
  has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
);
CREATE POLICY "Admins can update approval lines" ON public.approval_lines FOR UPDATE USING (
  has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
);
CREATE POLICY "Admins can delete approval lines" ON public.approval_lines FOR DELETE USING (
  has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
);
