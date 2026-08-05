-- Allow pre-login OTA download: anon may read app-updates bundles.
-- Writes remain master-only (existing policy).

DROP POLICY IF EXISTS "Authenticated can read app updates" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read app updates" ON storage.objects;

CREATE POLICY "Anyone can read app updates"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'app-updates');
