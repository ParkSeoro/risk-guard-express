-- Approach-warning ring around restricted zones (client-only for v1).
-- NULL = app default 25m. 0 = no buffer. Cap 200m so adjacent work zones stay usable.

ALTER TABLE public.restricted_zones
  ADD COLUMN IF NOT EXISTS buffer_m numeric NULL;

ALTER TABLE public.restricted_zones
  DROP CONSTRAINT IF EXISTS restricted_zones_buffer_m_range;

ALTER TABLE public.restricted_zones
  ADD CONSTRAINT restricted_zones_buffer_m_range
  CHECK (buffer_m IS NULL OR (buffer_m >= 0 AND buffer_m <= 200));

COMMENT ON COLUMN public.restricted_zones.buffer_m IS
  'Approach banner radius in meters outside the core geometry. NULL uses the client default (25). 0 disables the buffer.';
