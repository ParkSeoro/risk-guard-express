
DROP POLICY IF EXISTS "Authenticated can read app updates" ON storage.objects;
CREATE POLICY "Authenticated can read app updates"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'app-updates');

DROP POLICY IF EXISTS "Master can manage app updates" ON storage.objects;
CREATE POLICY "Master can manage app updates"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'app-updates'
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'master'::global_role))
  WITH CHECK (bucket_id = 'app-updates'
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'master'::global_role));
