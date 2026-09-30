-- 줄걸이 방법과 디바이스로 잇는 두 번째 줄걸이. 비어 있으면 기존 줄 수 계산을 유지한다.
ALTER TABLE public.rigging_plans
  ADD COLUMN IF NOT EXISTS sling_hitch text,
  ADD COLUMN IF NOT EXISTS sling_combination text,
  ADD COLUMN IF NOT EXISTS sling_device_safe_load numeric,
  ADD COLUMN IF NOT EXISTS sling_assembly_safe_load numeric,
  ADD COLUMN IF NOT EXISTS sling_secondary jsonb;

COMMENT ON COLUMN public.rigging_plans.sling_hitch IS
  '줄걸이 방법. straight, choke, basket, 2-leg, 3-leg, 4-leg. 비어 있으면 줄걸이 수로 계산.';
COMMENT ON COLUMN public.rigging_plans.sling_combination IS
  '디바이스 조합. series=한 줄로 연결, parallel=나란히. 비어 있으면 한 가지 줄걸이.';
COMMENT ON COLUMN public.rigging_plans.sling_device_safe_load IS
  '체결구 표식 안전하중(ton).';
COMMENT ON COLUMN public.rigging_plans.sling_assembly_safe_load IS
  '이종 재료를 나란히 쓸 때 제조사 조합 사용하중(ton).';
COMMENT ON COLUMN public.rigging_plans.sling_secondary IS
  '두 번째 줄걸이 제원.';
