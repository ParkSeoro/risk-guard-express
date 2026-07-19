-- company_members write policies were mis-scoped: named "Project admins can..." but used
-- is_company_project_member() which allows ANY project member. Restrict to admins.
DROP POLICY IF EXISTS "Project admins can insert company members" ON public.company_members;
DROP POLICY IF EXISTS "Project admins can update company members" ON public.company_members;
DROP POLICY IF EXISTS "Project admins can delete company members" ON public.company_members;

CREATE POLICY "Project admins can insert company members"
ON public.company_members FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = company_members.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)
  )
);

CREATE POLICY "Project admins can update company members"
ON public.company_members FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = company_members.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = company_members.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)
  )
);

CREATE POLICY "Project admins can delete company members"
ON public.company_members FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = company_members.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)
  )
);