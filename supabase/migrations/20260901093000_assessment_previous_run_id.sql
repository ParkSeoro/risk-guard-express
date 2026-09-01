-- Persist which 전회차 the 금주 이행 확인 tab uses.
-- NULL = automatic pick (same company + 승인완료 + earlier period).

ALTER TABLE public.assessment_runs
  ADD COLUMN IF NOT EXISTS previous_run_id uuid REFERENCES public.assessment_runs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.assessment_runs.previous_run_id IS
  '금주 이행 확인의 전회차(관리대상 출처). NULL이면 같은 업체·승인완료 회차를 자동 연결.';

CREATE INDEX IF NOT EXISTS assessment_runs_previous_run_id_idx
  ON public.assessment_runs (previous_run_id)
  WHERE previous_run_id IS NOT NULL;
