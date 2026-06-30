
DROP POLICY IF EXISTS "library_obj_select" ON storage.objects;
DROP POLICY IF EXISTS "library_obj_insert" ON storage.objects;
DROP POLICY IF EXISTS "library_obj_update" ON storage.objects;
DROP POLICY IF EXISTS "library_obj_delete" ON storage.objects;

CREATE POLICY "library_obj_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-library'
    AND EXISTS (
      SELECT 1 FROM public.project_library_files f
      WHERE f.file_path = storage.objects.name
        AND f.is_deleted = false
        AND public.is_project_member(auth.uid(), f.project_id)
    )
  );

CREATE POLICY "library_obj_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-library'
    AND owner = auth.uid()
  );

CREATE POLICY "library_obj_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'project-library'
    AND (owner = auth.uid()
      OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'))
  );

CREATE POLICY "library_obj_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-library'
    AND (owner = auth.uid()
      OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'))
  );
