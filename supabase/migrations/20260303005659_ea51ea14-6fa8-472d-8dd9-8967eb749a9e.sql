
-- Allow project-level project_admins to manage members (not just global admins)
DROP POLICY IF EXISTS "Admins can insert project members" ON public.project_members;
DROP POLICY IF EXISTS "Admins can update project members" ON public.project_members;
DROP POLICY IF EXISTS "Admins can delete project members" ON public.project_members;

CREATE POLICY "Project admins can insert members"
ON public.project_members FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(auth.uid(), project_id) = 'project_admin'::app_role
);

CREATE POLICY "Project admins can update members"
ON public.project_members FOR UPDATE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(auth.uid(), project_id) = 'project_admin'::app_role
);

CREATE POLICY "Project admins can delete members"
ON public.project_members FOR DELETE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(auth.uid(), project_id) = 'project_admin'::app_role
);
