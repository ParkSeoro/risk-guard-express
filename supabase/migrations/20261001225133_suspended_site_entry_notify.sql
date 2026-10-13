CREATE TABLE IF NOT EXISTS public.worker_suspension_site_presence (
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  inside boolean NOT NULL DEFAULT false,
  spot_name text,
  last_alert_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (worker_id, project_id)
);
ALTER TABLE public.worker_suspension_site_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.worker_suspension_site_presence FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.worker_suspension_site_presence TO service_role;
CREATE OR REPLACE FUNCTION public.geo_haversine_m(_lat1 float8, _lng1 float8, _lat2 float8, _lng2 float8)
RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(sqrt(least(1::float8,
    sin(radians(_lat2 - _lat1) / 2) ^ 2
    + cos(radians(_lat1)) * cos(radians(_lat2)) * sin(radians(_lng2 - _lng1) / 2) ^ 2
  )));
$$;
SELECT public.geo_haversine_m(37.5, 127.0, 37.5, 127.0) AS zero_m;
