-- Persist work_conditions (night_work, road_work, hot_work, near_power_lines) on work_plans
-- so conditional attachment toggles survive page reloads and never silently soft-delete slots.
ALTER TABLE public.work_plans
  ADD COLUMN IF NOT EXISTS work_conditions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.work_plans.work_conditions
  IS '작업계획서 조건 스위치(야간작업·도로작업·화기작업·활선근접 등) 영구 저장용 JSONB';
