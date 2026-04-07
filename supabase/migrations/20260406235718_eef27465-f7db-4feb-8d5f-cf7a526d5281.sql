-- Expand rigging_plans with full KOSHA standard fields

-- Section 1: 안전계수 프로그램 & 작성방법
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS safety_factor_passenger numeric DEFAULT 10,
  ADD COLUMN IF NOT EXISTS safety_factor_cargo numeric DEFAULT 5,
  ADD COLUMN IF NOT EXISTS input_method text DEFAULT '자동계산';

-- Section 2: 양중기 제원 확장
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS equipment_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS rated_capacity numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outrigger_distance numeric DEFAULT 0;

-- Section 2: 줄걸이기구 - 와이어로프
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS wire_diameter_mm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sling_count integer DEFAULT 2,
  ADD COLUMN IF NOT EXISTS sling_method text DEFAULT '',
  ADD COLUMN IF NOT EXISTS sling_strand_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sling_angle_deg numeric DEFAULT 60,
  ADD COLUMN IF NOT EXISTS wire_terminal_method text DEFAULT '탐블(24mm 이하)',
  ADD COLUMN IF NOT EXISTS wire_safety_coefficient integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS wire_lift_count integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS wire_breaking_load numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wire_diameter_inch numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wire_safe_load numeric DEFAULT 0;

-- Section 2: 체결장구 - 샤클
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS shackle_diameter_mm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shackle_safe_load numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shackle_angle_deg numeric DEFAULT 45,
  ADD COLUMN IF NOT EXISTS shackle_count numeric DEFAULT 0.7,
  ADD COLUMN IF NOT EXISTS shackle_qty integer DEFAULT 2;

-- Section 3: 중량물 제원 (최대)
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS load_name_max text DEFAULT '',
  ADD COLUMN IF NOT EXISTS hook_weight numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shackle_weight_val numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sling_rigging_weight numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_weight_max numeric DEFAULT 0;

-- Section 3: 중량물 제원 (최소)
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS load_name_min text DEFAULT '',
  ADD COLUMN IF NOT EXISTS load_weight_min numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hook_weight_min numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shackle_weight_min numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sling_rigging_weight_min numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_weight_min numeric DEFAULT 0;

-- Section 4: 장비 안전성 검토
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS wind_speed_grade text DEFAULT '0~5',
  ADD COLUMN IF NOT EXISTS wind_speed_factor numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS boom_rotation_factor numeric DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS ground_inspection_factor numeric DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS load_protrusion_factor numeric DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS travel_load_factor integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS equipment_working_load numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS equipment_ok text DEFAULT '';

-- Section 5: 줄걸이 안전성 검토 결과
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS sling_working_load numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sling_ok text DEFAULT '';

-- Section 6: 샤클 안전성 검토 결과
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS shackle_working_load numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shackle_ok text DEFAULT '';