DROP POLICY IF EXISTS "Members can view project members" ON public.project_members;

CREATE POLICY "Members and masters can view project members"
ON public.project_members
FOR SELECT
TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.is_project_member(auth.uid(), project_id)
);