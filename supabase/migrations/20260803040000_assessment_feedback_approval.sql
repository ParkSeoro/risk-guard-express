-- Feedback (조치) approval phase after assessment_run is 승인완료.
-- Separate entity_type so it does not fight assessment_run status.

ALTER TABLE public.assessment_runs
  ADD COLUMN IF NOT EXISTS feedback_status text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assessment_runs_feedback_status_check'
  ) THEN
    ALTER TABLE public.assessment_runs
      ADD CONSTRAINT assessment_runs_feedback_status_check
      CHECK (feedback_status IN ('none', 'in_progress', 'pending_approval', 'approved', 'closed'));
  END IF;
END $$;

COMMENT ON COLUMN public.assessment_runs.feedback_status IS
  'Feedback/조치 결재: none → in_progress → pending_approval → closed';

-- Finalize feedback approval without rewriting full act_on_entity_approval
CREATE OR REPLACE FUNCTION public.trg_assessment_feedback_approval_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending boolean;
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'assessment_run_feedback' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = '반려' AND OLD.status IS DISTINCT FROM '반려' THEN
    UPDATE public.assessment_runs
       SET feedback_status = 'in_progress',
           updated_at = now()
     WHERE id = NEW.entity_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status = '승인'
     AND OLD.status IS DISTINCT FROM '승인' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.approvals
       WHERE entity_type = 'assessment_run_feedback'
         AND entity_id = NEW.entity_id
         AND approval_version = NEW.approval_version
         AND status IN ('대기', '진행중')
    ) INTO v_pending;

    IF NOT v_pending THEN
      UPDATE public.assessment_runs
         SET feedback_status = 'closed',
             updated_at = now()
       WHERE id = NEW.entity_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assessment_feedback_approval_finalize ON public.approvals;
CREATE TRIGGER trg_assessment_feedback_approval_finalize
  AFTER UPDATE OF status ON public.approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_assessment_feedback_approval_finalize();
