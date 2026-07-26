
-- 1) Contractor detection helper
CREATE OR REPLACE FUNCTION public.is_contractor_user(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members pm
    JOIN public.companies c ON c.id = pm.company_id
    WHERE pm.user_id = _user_id
      AND pm.project_id = _project_id
      AND c.type = 'contractor'
  );
$$;

-- 2) ai_risk_cache project scoping
ALTER TABLE public.ai_risk_cache
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ai_risk_cache_project_id_idx ON public.ai_risk_cache(project_id);

-- Purge legacy cross-project cache rows (no project scope = cross-tenant leak)
DELETE FROM public.ai_risk_cache WHERE project_id IS NULL;

DROP POLICY IF EXISTS "Project members can view cache" ON public.ai_risk_cache;
DROP POLICY IF EXISTS "Project members can insert cache" ON public.ai_risk_cache;
DROP POLICY IF EXISTS "Project members can update cache" ON public.ai_risk_cache;

CREATE POLICY "Cache view scoped to project"
  ON public.ai_risk_cache FOR SELECT
  USING (
    is_master(auth.uid())
    OR (project_id IS NOT NULL AND is_project_member(auth.uid(), project_id))
  );

CREATE POLICY "Cache insert scoped to project"
  ON public.ai_risk_cache FOR INSERT
  WITH CHECK (
    project_id IS NOT NULL
    AND ((created_by IS NULL) OR (created_by = auth.uid()))
    AND (is_master(auth.uid()) OR is_project_member(auth.uid(), project_id))
  );

CREATE POLICY "Cache update scoped to project"
  ON public.ai_risk_cache FOR UPDATE
  USING (
    is_master(auth.uid())
    OR (project_id IS NOT NULL AND is_project_member(auth.uid(), project_id))
  )
  WITH CHECK (
    is_master(auth.uid())
    OR (project_id IS NOT NULL AND is_project_member(auth.uid(), project_id))
  );

-- 3) work_permits: contractor-scoped view/update
DROP POLICY IF EXISTS "Members can view work_permits" ON public.work_permits;
CREATE POLICY "Members can view work_permits"
  ON public.work_permits FOR SELECT
  USING (
    is_project_member(auth.uid(), project_id)
    AND (
      NOT is_contractor_user(auth.uid(), project_id)
      OR company_id = get_user_company_id(auth.uid(), project_id)
      OR created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Members can update work_permits" ON public.work_permits;
CREATE POLICY "Members can update work_permits"
  ON public.work_permits FOR UPDATE
  USING (
    is_project_member(auth.uid(), project_id)
    AND (
      NOT is_contractor_user(auth.uid(), project_id)
      OR company_id = get_user_company_id(auth.uid(), project_id)
      OR created_by = auth.uid()
    )
  );

-- 4) incident_reports: contractor-scoped view
DROP POLICY IF EXISTS "Members can view incident reports" ON public.incident_reports;
CREATE POLICY "Members can view incident reports"
  ON public.incident_reports FOR SELECT
  USING (
    is_project_member(auth.uid(), project_id)
    AND (
      NOT is_contractor_user(auth.uid(), project_id)
      OR company_id = get_user_company_id(auth.uid(), project_id)
      OR reporter_id = auth.uid()
    )
  );

-- 5) assessment_runs: contractor-scoped view/update
DROP POLICY IF EXISTS "Members can view runs" ON public.assessment_runs;
CREATE POLICY "Members can view runs"
  ON public.assessment_runs FOR SELECT
  USING (
    is_project_member(auth.uid(), project_id)
    AND (
      NOT is_contractor_user(auth.uid(), project_id)
      OR created_by = auth.uid()
      OR (
        target_company_ids IS NOT NULL
        AND get_user_company_id(auth.uid(), project_id) = ANY(target_company_ids)
      )
    )
  );

DROP POLICY IF EXISTS "Members can update runs" ON public.assessment_runs;
CREATE POLICY "Members can update runs"
  ON public.assessment_runs FOR UPDATE
  USING (
    is_project_member(auth.uid(), project_id)
    AND (
      NOT is_contractor_user(auth.uid(), project_id)
      OR created_by = auth.uid()
      OR (
        target_company_ids IS NOT NULL
        AND get_user_company_id(auth.uid(), project_id) = ANY(target_company_ids)
      )
    )
  );

GRANT EXECUTE ON FUNCTION public.is_contractor_user(uuid, uuid) TO authenticated, service_role;
