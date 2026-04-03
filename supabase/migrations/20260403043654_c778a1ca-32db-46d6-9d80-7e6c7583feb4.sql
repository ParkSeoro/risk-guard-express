
CREATE TABLE public.ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  api_key_encrypted text NOT NULL DEFAULT '',
  api_key_hint text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT 'gpt-4o',
  is_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE(project_id)
);

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Masters can view ai_settings"
  ON public.ai_settings FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "Masters can insert ai_settings"
  ON public.ai_settings FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "Masters can update ai_settings"
  ON public.ai_settings FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'master'::app_role));

CREATE TRIGGER update_ai_settings_updated_at
  BEFORE UPDATE ON public.ai_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
