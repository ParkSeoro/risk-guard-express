-- Weekly 이행 확인: keep 위평 개선후 상 rows, but allow this-week N/A / extra targets.

CREATE TABLE IF NOT EXISTS public.assessment_run_feedback_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  assessment_run_id uuid NOT NULL REFERENCES public.assessment_runs(id) ON DELETE CASCADE,
  risk_item_id uuid NOT NULL REFERENCES public.risk_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('manual_include', 'exclude')),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_run_id, risk_item_id),
  CONSTRAINT assessment_run_feedback_overrides_exclude_reason
    CHECK (
      (kind = 'exclude' AND reason IN ('해당없음', '작업 미실시', '공정 변경'))
      OR (kind = 'manual_include' AND reason IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS assessment_run_feedback_overrides_run_idx
  ON public.assessment_run_feedback_overrides (assessment_run_id);

ALTER TABLE public.assessment_run_feedback_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view feedback overrides" ON public.assessment_run_feedback_overrides;
CREATE POLICY "Members can view feedback overrides"
  ON public.assessment_run_feedback_overrides FOR SELECT
  TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS "Members can insert feedback overrides" ON public.assessment_run_feedback_overrides;
CREATE POLICY "Members can insert feedback overrides"
  ON public.assessment_run_feedback_overrides FOR INSERT
  TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS "Members can update feedback overrides" ON public.assessment_run_feedback_overrides;
CREATE POLICY "Members can update feedback overrides"
  ON public.assessment_run_feedback_overrides FOR UPDATE
  TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS "Members can delete feedback overrides" ON public.assessment_run_feedback_overrides;
CREATE POLICY "Members can delete feedback overrides"
  ON public.assessment_run_feedback_overrides FOR DELETE
  TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_assessment_run_feedback_overrides_updated_at
  ON public.assessment_run_feedback_overrides;
CREATE TRIGGER update_assessment_run_feedback_overrides_updated_at
  BEFORE UPDATE ON public.assessment_run_feedback_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_run_feedback_overrides TO authenticated;
