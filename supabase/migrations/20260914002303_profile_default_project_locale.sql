-- Profile home project + worker UI locale.
-- Approved document snapshots stay Korean; worker viewers may cache display translations.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ui_locale text NOT NULL DEFAULT 'ko';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_ui_locale_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_ui_locale_check
  CHECK (ui_locale IN ('ko', 'en', 'zh', 'ja'));

CREATE INDEX IF NOT EXISTS idx_profiles_default_project_id
  ON public.profiles (default_project_id)
  WHERE default_project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.doc_view_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  locale text NOT NULL CHECK (locale IN ('en', 'zh', 'ja')),
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, locale, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_doc_view_translations_lookup
  ON public.doc_view_translations (entity_type, entity_id, locale);

ALTER TABLE public.doc_view_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read doc view translations" ON public.doc_view_translations;
CREATE POLICY "Authenticated can read doc view translations"
  ON public.doc_view_translations
  FOR SELECT
  TO authenticated
  USING (true);

-- Writes go through the translate-doc-view edge function (service role).
REVOKE INSERT, UPDATE, DELETE ON public.doc_view_translations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.doc_view_translations TO authenticated;
GRANT ALL ON public.doc_view_translations TO service_role;
