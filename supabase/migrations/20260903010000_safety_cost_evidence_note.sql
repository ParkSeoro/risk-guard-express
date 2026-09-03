-- 세금계산서 한 장을 여러 비목에 복제할 때, 총액 중 이 비목 금액을 수기로 적는다.
ALTER TABLE public.safety_cost_evidence_files
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.safety_cost_evidence_files.note IS
  'Per-category allocation memo for a shared tax invoice (how much of the invoice total belongs to this 비목).';
