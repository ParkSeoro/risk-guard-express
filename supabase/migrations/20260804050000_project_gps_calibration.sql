-- Project-level GPS bias calibration (master field 1-point align).
-- corrected = raw + (d_lat, d_lng)

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS gps_calibration jsonb NULL;

COMMENT ON COLUMN public.projects.gps_calibration IS
  'Optional GPS bias: {d_lat,d_lng,accuracy_m,site_map_id,map_lat,map_lng,raw_lat,raw_lng,calibrated_at,calibrated_by}. Applied in track-location + clients.';
