
CREATE TABLE IF NOT EXISTS public.app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  channel text NOT NULL DEFAULT 'stable',
  bundle_url text NOT NULL,
  checksum text,
  mandatory boolean NOT NULL DEFAULT false,
  min_native_version text,
  notes text,
  released_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, version)
);

GRANT SELECT ON public.app_releases TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.app_releases TO authenticated;
GRANT ALL ON public.app_releases TO service_role;

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read non-deleted releases"
  ON public.app_releases FOR SELECT
  USING (is_deleted = false);

CREATE POLICY "Master can manage releases"
  ON public.app_releases FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'master'::global_role))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'master'::global_role));

CREATE OR REPLACE FUNCTION public.set_app_releases_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_app_releases_updated ON public.app_releases;
CREATE TRIGGER trg_app_releases_updated
BEFORE UPDATE ON public.app_releases
FOR EACH ROW EXECUTE FUNCTION public.set_app_releases_updated_at();

CREATE OR REPLACE FUNCTION public.get_latest_app_release(_channel text DEFAULT 'stable')
RETURNS TABLE (
  version text, channel text, bundle_url text, checksum text,
  mandatory boolean, min_native_version text, released_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT version, channel, bundle_url, checksum, mandatory, min_native_version, released_at
  FROM public.app_releases
  WHERE is_deleted = false AND channel = COALESCE(_channel, 'stable')
  ORDER BY released_at DESC
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.get_latest_app_release(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_app_release(text) TO anon, authenticated, service_role;
