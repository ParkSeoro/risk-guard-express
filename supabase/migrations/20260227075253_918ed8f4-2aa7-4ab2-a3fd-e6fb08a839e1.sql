DROP POLICY IF EXISTS "Authenticated can view attachments" ON storage.objects;
CREATE POLICY "Owner can view attachments" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]
);