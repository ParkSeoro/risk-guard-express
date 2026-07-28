-- Weather / third-party API keys (master-managed). Edge Functions read via service role.
CREATE TABLE IF NOT EXISTS public.integration_secrets (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  hint text NOT NULL DEFAULT '',
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Masters can read integration_secrets" ON public.integration_secrets;
CREATE POLICY "Masters can read integration_secrets"
  ON public.integration_secrets FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()));

DROP POLICY IF EXISTS "Masters can upsert integration_secrets" ON public.integration_secrets;
CREATE POLICY "Masters can upsert integration_secrets"
  ON public.integration_secrets FOR ALL TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

COMMENT ON TABLE public.integration_secrets IS 'Master-managed API keys (KMA/OpenWeather etc). Edge Functions read with service role.';
