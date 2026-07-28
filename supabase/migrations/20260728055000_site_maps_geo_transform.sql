-- Persist rotated/skewed drone overlay corners (TL/TR/BL) + opacity.
ALTER TABLE public.site_maps
  ADD COLUMN IF NOT EXISTS geo_transform jsonb;

COMMENT ON COLUMN public.site_maps.geo_transform IS
  'Visual georef: { tl:{lat,lng}, tr:{lat,lng}, bl:{lat,lng}, opacity?:number }';
