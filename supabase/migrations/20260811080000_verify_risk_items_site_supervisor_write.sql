-- Idempotent re-assert: risk_items write roles = riskWriteAccess SSOT.
-- Excel upload and AI auto-gen both hit these policies; AI also has a client
-- precheck that must list the same roles (src/lib/riskWriteAccess.ts).
-- Safe to re-run if 20260811073000 was already applied.

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
