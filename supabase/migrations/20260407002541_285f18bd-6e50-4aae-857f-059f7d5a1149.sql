
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS sling_material_type text DEFAULT 'wire_rope',
  ADD COLUMN IF NOT EXISTS sling_belt_color text DEFAULT '',
  ADD COLUMN IF NOT EXISTS sling_belt_width_mm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sling_belt_rated_load numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_sling_rated_load numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_diameter_mm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_rated_load numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_leg_count integer DEFAULT 4,
  ADD COLUMN IF NOT EXISTS shackle_inch text DEFAULT '',
  ADD COLUMN IF NOT EXISTS sling_safe_load numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tension_per_leg numeric DEFAULT 0;
