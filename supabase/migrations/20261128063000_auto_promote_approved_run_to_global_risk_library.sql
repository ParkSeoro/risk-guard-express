-- Automatically promote risk items from an approved assessment_run into global_risk_library
-- when assessment_runs.status transitions to '승인완료'.
-- Non-blocking: wrapped in EXCEPTION WHEN OTHERS so approval is never blocked.

CREATE OR REPLACE FUNCTION public.trg_promote_approved_run_to_library()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = '승인완료'
     AND OLD.status IS DISTINCT FROM '승인완료'
     AND COALESCE(NEW.is_deleted, false) = false
  THEN
    PERFORM public.promote_run_to_global_risk_library(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_assessment_run_promote_library'
      AND tgrelid = 'public.assessment_runs'::regclass
  ) THEN
    CREATE TRIGGER trg_assessment_run_promote_library
      AFTER UPDATE OF status ON public.assessment_runs
      FOR EACH ROW
      WHEN (NEW.status = '승인완료' AND OLD.status IS DISTINCT FROM '승인완료')
      EXECUTE FUNCTION public.trg_promote_approved_run_to_library();
  END IF;
END;
$$;
