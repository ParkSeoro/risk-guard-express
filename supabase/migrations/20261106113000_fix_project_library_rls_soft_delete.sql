-- Fix RLS policy on project_library_files to allow soft-delete (setting is_deleted = true)
-- Previously, library_select_members had `USING (is_deleted = false AND is_project_member(...))`.
-- In PostgreSQL RLS, updating a row so that it changes `is_deleted = true` evaluates against
-- visibility policies, triggering:
--   "42501: new row violates row-level security policy for table 'project_library_files'"
--
-- We alter the policies so:
-- 1. SELECT policy permits viewing if not deleted, or if the user is the uploader, project admin, safety manager, or master.
-- 2. UPDATE and DELETE policies permit the uploader, project admin, safety manager, or master.

ALTER POLICY "library_select_members" ON public.project_library_files
USING (
  public.is_project_member(auth.uid(), project_id)
  AND (
    is_deleted = false
    OR uploaded_by = auth.uid()
    OR public.is_project_admin_or_safety(project_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master')
  )
);

ALTER POLICY "library_update_uploader_or_master" ON public.project_library_files
USING (
  uploaded_by = auth.uid()
  OR public.is_project_admin_or_safety(project_id, auth.uid())
  OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master')
);

ALTER POLICY "library_delete_uploader_or_master" ON public.project_library_files
USING (
  uploaded_by = auth.uid()
  OR public.is_project_admin_or_safety(project_id, auth.uid())
  OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master')
);
