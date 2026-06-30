
ALTER TABLE public.permit_form_templates
  ADD COLUMN IF NOT EXISTS original_pdf_url text,
  ADD COLUMN IF NOT EXISTS print_overlay jsonb NOT NULL DEFAULT '{"pages":[]}'::jsonb;

CREATE TABLE IF NOT EXISTS public.permit_form_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.permit_form_templates(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  layout_json jsonb NOT NULL,
  print_overlay jsonb NOT NULL DEFAULT '{"pages":[]}'::jsonb,
  original_pdf_url text,
  snapshot_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_form_template_versions TO authenticated;
GRANT ALL ON public.permit_form_template_versions TO service_role;

ALTER TABLE public.permit_form_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read template versions"
  ON public.permit_form_template_versions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Masters can write template versions"
  ON public.permit_form_template_versions FOR ALL TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_permit_form_template_versions_template
  ON public.permit_form_template_versions(template_id, created_at DESC);

DROP POLICY IF EXISTS "permit_form_assets_read" ON storage.objects;
CREATE POLICY "permit_form_assets_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'permit-form-assets');

DROP POLICY IF EXISTS "permit_form_assets_write_master" ON storage.objects;
CREATE POLICY "permit_form_assets_write_master"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'permit-form-assets' AND public.is_master(auth.uid()));

DROP POLICY IF EXISTS "permit_form_assets_update_master" ON storage.objects;
CREATE POLICY "permit_form_assets_update_master"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'permit-form-assets' AND public.is_master(auth.uid()))
  WITH CHECK (bucket_id = 'permit-form-assets' AND public.is_master(auth.uid()));

DROP POLICY IF EXISTS "permit_form_assets_delete_master" ON storage.objects;
CREATE POLICY "permit_form_assets_delete_master"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'permit-form-assets' AND public.is_master(auth.uid()));
