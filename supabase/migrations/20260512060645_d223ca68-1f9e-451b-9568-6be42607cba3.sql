
-- Fix B1: companies RLS had reversed args to get_project_role.
-- Rewrite using new helpers (is_master + has_project_role).

DROP POLICY IF EXISTS "Project admins can delete companies" ON public.companies;
DROP POLICY IF EXISTS "Project admins can insert companies" ON public.companies;
DROP POLICY IF EXISTS "Project admins can update companies" ON public.companies;

CREATE POLICY "Owners can insert companies"
  ON public.companies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_master(auth.uid())
    OR public.has_project_role(
         auth.uid(), project_id,
         ARRAY['project_admin','safety_manager']::public.project_role[]
       )
  );

CREATE POLICY "Owners can update companies"
  ON public.companies
  FOR UPDATE
  TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_project_role(
         auth.uid(), project_id,
         ARRAY['project_admin','safety_manager']::public.project_role[]
       )
  );

CREATE POLICY "Owners can delete companies"
  ON public.companies
  FOR DELETE
  TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_project_role(
         auth.uid(), project_id,
         ARRAY['project_admin']::public.project_role[]
       )
  );
