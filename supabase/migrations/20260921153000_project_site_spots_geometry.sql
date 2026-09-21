-- GPS 개소 can be drawn as polygon/circle on the control map.
-- Attendance = inside the shape or within buffer_m (100–300) of the edge.

ALTER TABLE public.project_site_spots
  ADD COLUMN IF NOT EXISTS geometry_type TEXT NOT NULL DEFAULT 'radius';

ALTER TABLE public.project_site_spots
  ADD COLUMN IF NOT EXISTS geo_polygon JSONB;

ALTER TABLE public.project_site_spots
  ADD COLUMN IF NOT EXISTS buffer_m NUMERIC NOT NULL DEFAULT 150;

ALTER TABLE public.project_site_spots
  DROP CONSTRAINT IF EXISTS project_site_spots_geometry_type_check;
ALTER TABLE public.project_site_spots
  ADD CONSTRAINT project_site_spots_geometry_type_check
  CHECK (geometry_type IN ('polygon', 'radius'));

ALTER TABLE public.project_site_spots
  DROP CONSTRAINT IF EXISTS project_site_spots_buffer_m_range;
ALTER TABLE public.project_site_spots
  ADD CONSTRAINT project_site_spots_buffer_m_range
  CHECK (buffer_m >= 100 AND buffer_m <= 300);

COMMENT ON COLUMN public.project_site_spots.geometry_type IS
  'polygon or radius. Drawn on 관제맵; legacy rows are radius from lat/lng form.';
COMMENT ON COLUMN public.project_site_spots.buffer_m IS
  '출근 허용: 도형 바깥 이 거리(m). 100–300.';
