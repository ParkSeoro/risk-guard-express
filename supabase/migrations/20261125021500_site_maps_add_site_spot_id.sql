-- Phase 2: Multi-spot drone map linking (strictly additive, backward-compatible)
-- NULL site_spot_id means shared / project-wide map.

ALTER TABLE public.site_maps
  ADD COLUMN IF NOT EXISTS site_spot_id uuid NULL
  REFERENCES public.project_site_spots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_maps_project_spot
  ON public.site_maps (project_id, site_spot_id)
  WHERE is_deleted = false;

COMMENT ON COLUMN public.site_maps.site_spot_id IS
  'Optional link to project_site_spots(id) for multi-spot projects; NULL means shared project-wide map.';
