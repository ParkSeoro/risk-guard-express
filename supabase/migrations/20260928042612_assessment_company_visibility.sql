-- Risk assessment visibility follows the project company tree.
-- 발주처 관리자와 마스터만 현장 전체.
-- 시공사는 자기 회사와 project_companies 하위 협력사만.
-- 협력사는 자기 회사만.
-- A blank target_company_ids is the author's company, not a shared bucket.

CREATE OR REPLACE FUNCTION public.project_company_tree(_project_id uuid, _root uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH RECURSIVE tree AS (
    SELECT _root AS company_id
    WHERE _root IS NOT NULL
    UNION
    SELECT pc.company_id
      FROM public.project_companies pc
      JOIN tree t ON pc.parent_company_id = t.company_id
     WHERE pc.project_id = _project_id
       AND COALESCE(pc.is_deleted, false) = false
  )
  SELECT COALESCE(array_agg(DISTINCT company_id), ARRAY[]::uuid[])
    FROM tree
   WHERE company_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.can_read_assessment_run(_run public.assessment_runs, _uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _eff uuid[];
  _rec record;
  _type text;
  _role text;
  _tree uuid[];
BEGIN
  IF _uid IS NULL OR _run.id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_master(_uid) THEN
    RETURN true;
  END IF;
  IF NOT public.is_project_member(_uid, _run.project_id) THEN
    RETURN false;
  END IF;
  IF _run.created_by = _uid OR _run.author_user_id = _uid THEN
    RETURN true;
  END IF;

  _eff := public.assessment_run_effective_company_ids(_run);

  FOR _rec IN
    SELECT pm.company_id, pm.role_new, c.type AS company_type
      FROM public.project_members pm
      LEFT JOIN public.companies c ON c.id = pm.company_id
     WHERE pm.user_id = _uid
       AND pm.project_id = _run.project_id
  LOOP
    _type := lower(trim(COALESCE(_rec.company_type, '')));
    _role := lower(trim(COALESCE(_rec.role_new::text, '')));

    IF _type IN ('client', '발주처', 'owner', '발주')
       AND _role IN ('project_admin', 'safety_manager', 'site_manager', 'supervisor', 'site_supervisor') THEN
      RETURN true;
    END IF;

    IF _type IN ('gc', '시공사', '원도급', '원청', 'general_contractor')
       AND _role NOT IN ('worker', 'viewer') THEN
      _tree := public.project_company_tree(_run.project_id, _rec.company_id);
      IF _eff && _tree THEN
        RETURN true;
      END IF;
      CONTINUE;
    END IF;

    IF _rec.company_id IS NOT NULL AND _rec.company_id = ANY(_eff) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_assessment_run_by_id(_run_id uuid, _uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _run public.assessment_runs;
BEGIN
  IF _run_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO _run FROM public.assessment_runs WHERE id = _run_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN public.can_read_assessment_run(_run, _uid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.project_company_tree(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_assessment_run(public.assessment_runs, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_assessment_run_by_id(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Admins can delete runs" ON public.assessment_runs;
CREATE POLICY "Admins can delete runs"
  ON public.assessment_runs FOR DELETE
  USING (
    public.can_read_assessment_run(assessment_runs, auth.uid())
    AND (is_master(auth.uid()) OR is_project_admin(auth.uid(), project_id))
  );

DROP POLICY IF EXISTS "Members can view runs" ON public.assessment_runs;
CREATE POLICY "Members can view runs"
  ON public.assessment_runs FOR SELECT
  USING (public.can_read_assessment_run(assessment_runs, auth.uid()));

DROP POLICY IF EXISTS "Members can update runs" ON public.assessment_runs;
CREATE POLICY "Members can update runs"
  ON public.assessment_runs FOR UPDATE
  USING (public.can_read_assessment_run(assessment_runs, auth.uid()))
  WITH CHECK (public.can_read_assessment_run(assessment_runs, auth.uid()));

DROP POLICY IF EXISTS "Members can view feedback" ON public.risk_item_feedback;
CREATE POLICY "Members can view feedback"
  ON public.risk_item_feedback FOR SELECT
  USING (public.can_read_assessment_run_by_id(assessment_run_id, auth.uid()));

DROP POLICY IF EXISTS "Members can insert feedback" ON public.risk_item_feedback;
CREATE POLICY "Members can insert feedback"
  ON public.risk_item_feedback FOR INSERT
  WITH CHECK (public.can_read_assessment_run_by_id(assessment_run_id, auth.uid()));

DROP POLICY IF EXISTS "Members can update feedback" ON public.risk_item_feedback;
CREATE POLICY "Members can update feedback"
  ON public.risk_item_feedback FOR UPDATE
  USING (public.can_read_assessment_run_by_id(assessment_run_id, auth.uid()))
  WITH CHECK (public.can_read_assessment_run_by_id(assessment_run_id, auth.uid()));

DROP POLICY IF EXISTS "Admins can delete feedback" ON public.risk_item_feedback;
CREATE POLICY "Admins can delete feedback"
  ON public.risk_item_feedback FOR DELETE
  USING (public.can_read_assessment_run_by_id(assessment_run_id, auth.uid()));

DROP POLICY IF EXISTS "Members can view risk items" ON public.risk_items;
CREATE POLICY "Members can view risk items"
  ON public.risk_items FOR SELECT
  USING (public.can_read_assessment_run_by_id(run_id, auth.uid()));

DROP POLICY IF EXISTS "Non-viewers can insert risk items" ON public.risk_items;
CREATE POLICY "Non-viewers can insert risk items"
  ON public.risk_items FOR INSERT
  WITH CHECK (
    public.can_read_assessment_run_by_id(run_id, auth.uid())
    AND (
      has_project_role(auth.uid(), project_id, ARRAY['project_admin'::project_role, 'safety_manager'::project_role, 'site_manager'::project_role, 'site_supervisor'::project_role])
      OR is_master(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Non-viewers can update risk items" ON public.risk_items;
CREATE POLICY "Non-viewers can update risk items"
  ON public.risk_items FOR UPDATE
  USING (
    public.can_read_assessment_run_by_id(run_id, auth.uid())
    AND (
      has_project_role(auth.uid(), project_id, ARRAY['project_admin'::project_role, 'safety_manager'::project_role, 'site_manager'::project_role, 'site_supervisor'::project_role])
      OR is_master(auth.uid())
    )
  )
  WITH CHECK (
    public.can_read_assessment_run_by_id(run_id, auth.uid())
    AND (
      has_project_role(auth.uid(), project_id, ARRAY['project_admin'::project_role, 'safety_manager'::project_role, 'site_manager'::project_role, 'site_supervisor'::project_role])
      OR is_master(auth.uid())
    )
  );

-- Fill blank target companies from the author. Does not move risk rows or photos.
-- Submitted runs are otherwise locked; this only writes the missing company tag.
SELECT set_config('app.skip_document_edit_lock', '1', true);

UPDATE public.assessment_runs ar
   SET target_company_ids = public.assessment_run_effective_company_ids(ar),
       updated_at = now()
 WHERE COALESCE(ar.is_deleted, false) = false
   AND COALESCE(array_length(ar.target_company_ids, 1), 0) = 0
   AND COALESCE(array_length(public.assessment_run_effective_company_ids(ar), 1), 0) > 0;
