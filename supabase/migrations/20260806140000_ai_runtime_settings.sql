-- Global AI runtime settings (NVIDIA model chain + failover).
-- Replaces Lovable-era per-project ai_settings for actual Edge AI calls.
-- API keys stay in Supabase Edge Secrets (NVIDIA_API_KEY), not in this table.

CREATE TABLE IF NOT EXISTS public.ai_runtime_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_enabled boolean NOT NULL DEFAULT true,
  failover_enabled boolean NOT NULL DEFAULT true,
  model_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

COMMENT ON TABLE public.ai_runtime_settings IS
  'Singleton AI runtime config: NVIDIA model failover chain. Keys live in Edge Secrets.';

ALTER TABLE public.ai_runtime_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Masters can view ai_runtime_settings" ON public.ai_runtime_settings;
DROP POLICY IF EXISTS "Masters can insert ai_runtime_settings" ON public.ai_runtime_settings;
DROP POLICY IF EXISTS "Masters can update ai_runtime_settings" ON public.ai_runtime_settings;

CREATE POLICY "Masters can view ai_runtime_settings"
  ON public.ai_runtime_settings FOR SELECT
  TO authenticated
  USING (is_master(auth.uid()));

CREATE POLICY "Masters can insert ai_runtime_settings"
  ON public.ai_runtime_settings FOR INSERT
  TO authenticated
  WITH CHECK (is_master(auth.uid()));

CREATE POLICY "Masters can update ai_runtime_settings"
  ON public.ai_runtime_settings FOR UPDATE
  TO authenticated
  USING (is_master(auth.uid()));

-- Seed default chain (primary = current production Nemotron Super)
INSERT INTO public.ai_runtime_settings (id, is_enabled, failover_enabled, model_chain)
VALUES (
  1,
  true,
  true,
  '[
    {"id":"nvidia/llama-3.3-nemotron-super-49b-v1.5","enabled":true},
    {"id":"meta/llama-3.3-70b-instruct","enabled":true},
    {"id":"nvidia/llama-3.1-nemotron-70b-instruct","enabled":true},
    {"id":"mistralai/mistral-small-3.1-24b-instruct-2503","enabled":true}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_ai_runtime_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS ai_runtime_settings_updated_at ON public.ai_runtime_settings;
CREATE TRIGGER ai_runtime_settings_updated_at
  BEFORE UPDATE ON public.ai_runtime_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_ai_runtime_settings_updated_at();
