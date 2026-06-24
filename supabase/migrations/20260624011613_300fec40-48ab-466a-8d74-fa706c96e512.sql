
ALTER TABLE public.site_maps
  ADD COLUMN IF NOT EXISTS geo_anchor_nw_lat numeric,
  ADD COLUMN IF NOT EXISTS geo_anchor_nw_lng numeric,
  ADD COLUMN IF NOT EXISTS geo_anchor_se_lat numeric,
  ADD COLUMN IF NOT EXISTS geo_anchor_se_lng numeric;

ALTER TABLE public.site_zones
  ADD COLUMN IF NOT EXISTS geo_polygon jsonb,
  ADD COLUMN IF NOT EXISTS wifi_fingerprint jsonb;

ALTER TABLE public.worker_zone_events
  ADD COLUMN IF NOT EXISTS lat numeric,
  ADD COLUMN IF NOT EXISTS lng numeric,
  ADD COLUMN IF NOT EXISTS accuracy_m numeric;

COMMENT ON COLUMN public.worker_zone_events.source IS 'qr | gps | wifi | manual';

CREATE TABLE IF NOT EXISTS public.wifi_fingerprint_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.site_zones(id) ON DELETE CASCADE,
  bssid text NOT NULL,
  ssid text,
  rssi integer NOT NULL,
  sample_at timestamptz NOT NULL DEFAULT now(),
  collected_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wifi_fingerprint_samples TO authenticated;
GRANT ALL ON public.wifi_fingerprint_samples TO service_role;

ALTER TABLE public.wifi_fingerprint_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can read fingerprint samples"
  ON public.wifi_fingerprint_samples FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = wifi_fingerprint_samples.project_id
        AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project admins can insert fingerprint samples"
  ON public.wifi_fingerprint_samples FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
  );

CREATE POLICY "Project admins can update fingerprint samples"
  ON public.wifi_fingerprint_samples FOR UPDATE
  TO authenticated
  USING (
    public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
  );

CREATE POLICY "Project admins can delete fingerprint samples"
  ON public.wifi_fingerprint_samples FOR DELETE
  TO authenticated
  USING (
    public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
  );

CREATE INDEX IF NOT EXISTS idx_wifi_fp_samples_zone ON public.wifi_fingerprint_samples(zone_id);
CREATE INDEX IF NOT EXISTS idx_wifi_fp_samples_project ON public.wifi_fingerprint_samples(project_id);
CREATE INDEX IF NOT EXISTS idx_worker_zone_events_project_created ON public.worker_zone_events(project_id, created_at DESC);
