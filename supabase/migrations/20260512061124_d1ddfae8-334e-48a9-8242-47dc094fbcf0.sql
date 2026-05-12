
-- ============================================================
-- Phase 3: Unify SELECT policies to use can_access_company_data
-- ============================================================
-- Pattern per table:
--   USING (is_project_member(auth.uid(), project_id)
--          AND can_access_company_data(auth.uid(), project_id, company_id))
-- can_access_company_data returns true for master/project_admin/safety_manager.

-- work_plans
DROP POLICY IF EXISTS "Members can view work plans" ON public.work_plans;
CREATE POLICY "Company-scoped view: work_plans"
  ON public.work_plans FOR SELECT TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND public.can_access_company_data(auth.uid(), project_id, company_id)
  );

-- tbm_sessions
DROP POLICY IF EXISTS "Members can view tbm_sessions" ON public.tbm_sessions;
CREATE POLICY "Company-scoped view: tbm_sessions"
  ON public.tbm_sessions FOR SELECT TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND public.can_access_company_data(auth.uid(), project_id, company_id)
  );

-- safety_inspections
DROP POLICY IF EXISTS "Members can view inspections" ON public.safety_inspections;
CREATE POLICY "Company-scoped view: safety_inspections"
  ON public.safety_inspections FOR SELECT TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND public.can_access_company_data(auth.uid(), project_id, company_id)
  );

-- workers
DROP POLICY IF EXISTS "workers_select" ON public.workers;
CREATE POLICY "Company-scoped view: workers"
  ON public.workers FOR SELECT TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND public.can_access_company_data(auth.uid(), project_id, company_id)
  );

-- safety_education_materials
DROP POLICY IF EXISTS "edu_mat_select" ON public.safety_education_materials;
CREATE POLICY "Company-scoped view: safety_education_materials"
  ON public.safety_education_materials FOR SELECT TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND public.can_access_company_data(auth.uid(), project_id, company_id)
  );

-- equipment_master
DROP POLICY IF EXISTS "Members can view equipment" ON public.equipment_master;
CREATE POLICY "Company-scoped view: equipment_master"
  ON public.equipment_master FOR SELECT TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND public.can_access_company_data(auth.uid(), project_id, company_id)
  );

-- legal_duties
DROP POLICY IF EXISTS "Members can view legal duties" ON public.legal_duties;
CREATE POLICY "Company-scoped view: legal_duties"
  ON public.legal_duties FOR SELECT TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND public.can_access_company_data(auth.uid(), project_id, company_id)
  );

-- company_construction_info
DROP POLICY IF EXISTS "Members can view construction info" ON public.company_construction_info;
CREATE POLICY "Company-scoped view: company_construction_info"
  ON public.company_construction_info FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_id
        AND public.is_project_member(auth.uid(), c.project_id)
        AND public.can_access_company_data(auth.uid(), c.project_id, c.id)
    )
  );

-- company_members
DROP POLICY IF EXISTS "Project members can view company members" ON public.company_members;
CREATE POLICY "Company-scoped view: company_members"
  ON public.company_members FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_id
        AND public.is_project_member(auth.uid(), c.project_id)
        AND public.can_access_company_data(auth.uid(), c.project_id, c.id)
    )
  );

-- approvals (approvals has project_id and company_id; some approvals may have NULL company_id)
DROP POLICY IF EXISTS "Members can view approvals" ON public.approvals;
CREATE POLICY "Company-scoped view: approvals"
  ON public.approvals FOR SELECT TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND (
      company_id IS NULL
      OR public.can_access_company_data(auth.uid(), project_id, company_id)
    )
  );

-- approval_lines
DROP POLICY IF EXISTS "Project members can view approval lines" ON public.approval_lines;
CREATE POLICY "Company-scoped view: approval_lines"
  ON public.approval_lines FOR SELECT TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND (
      company_id IS NULL
      OR public.can_access_company_data(auth.uid(), project_id, company_id)
    )
  );
