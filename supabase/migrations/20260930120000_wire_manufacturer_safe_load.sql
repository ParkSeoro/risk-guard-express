-- 와이어로프 제조사 안전하중. 값이 있으면 줄걸이 판정에 쓰고, 비어 있으면 지름 표를 유지한다.
-- 기존 행은 채우지 않는다.
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS wire_manufacturer_safe_load numeric;

COMMENT ON COLUMN public.rigging_plans.wire_manufacturer_safe_load IS
  '제조사 안전하중(ton). 0보다 크면 와이어 줄걸이 판정에 사용. 비어 있으면 지름 표(절단하중/안전계수).';
