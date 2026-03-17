UPDATE storage.buckets SET public = true WHERE id = 'attachments';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated users can upload"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'attachments');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public can read attachments' AND tablename = 'objects') THEN
    CREATE POLICY "Public can read attachments"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'attachments');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can delete own' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated users can delete own"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'attachments');
  END IF;
END $$;