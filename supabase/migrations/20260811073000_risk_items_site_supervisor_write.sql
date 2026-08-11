-- Fix: 관리감독자(site_supervisor) can write risk_items (고시 §7 author).
-- Evidence:
--   UI SSOT (useProjectAccess): site_supervisor = CRUD_NO_APPROVE on risk_assessment;
--   supervisor(감리) = RO.
--   Latest risk_items policies (20260722054410) only allowed
--   project_admin / safety_manager / site_manager / supervisor — missing site_supervisor.
--   Client precheck in riskAutoGenJob mirrored that bug → auto-gen blocked for 관리감독자.
-- Align INSERT/UPDATE with SSOT; drop supervisor (감리) write on risk_items.

DROP POLICY IF EXISTS "Non-viewers can insert risk items" ON public.risk_items;
DROP POLICY IF EXISTS "Non-viewers can update risk items" ON public.risk_items;

CREATE POLICY "Non-viewers can insert risk items"
ON public.risk_items FOR INSERT TO authenticated
WITH CHECK (
  public.has_project_role(
    auth.uid(),
    project_id,
    ARRAY[
      'project_admin',
      'safety_manager',
      'site_manager',
      'site_supervisor'
    ]::public.project_role[]
  )
  OR public.is_master(auth.uid())
);

CREATE POLICY "Non-viewers can update risk items"
ON public.risk_items FOR UPDATE TO authenticated
USING (
  public.has_project_role(
    auth.uid(),
    project_id,
    ARRAY[
      'project_admin',
      'safety_manager',
      'site_manager',
      'site_supervisor'
    ]::public.project_role[]
  )
  OR public.is_master(auth.uid())
)
WITH CHECK (
  public.has_project_role(
    auth.uid(),
    project_id,
    ARRAY[
      'project_admin',
      'safety_manager',
      'site_manager',
      'site_supervisor'
    ]::public.project_role[]
  )
  OR public.is_master(auth.uid())
);
