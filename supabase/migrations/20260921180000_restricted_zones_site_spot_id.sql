-- Tag danger/presence zones with the GPS 개소 they were drawn for.
-- Sirens stay project-wide (any zone can fire). This is list/camera grouping only.

ALTER TABLE public.restricted_zones
  ADD COLUMN IF NOT EXISTS site_spot_id UUID
    REFERENCES public.project_site_spots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restricted_zones_site_spot
  ON public.restricted_zones(site_spot_id)
  WHERE is_deleted = false AND site_spot_id IS NOT NULL;

COMMENT ON COLUMN public.restricted_zones.site_spot_id IS
  '관제맵에서 그린 작업 개소. NULL = 개소 도입 전/미지정. 사이렌 매칭에는 쓰지 않음.';
