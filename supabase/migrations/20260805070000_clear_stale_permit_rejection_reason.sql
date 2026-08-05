-- Clear stale work_permits.rejection_reason after re-submit / issue.
-- Previously reject set the field, but approve/resubmit left it, so UI showed
-- "반려: …" under already-issued (발행 완료) permits.

-- Heal existing rows that are no longer rejected
UPDATE public.work_permits
   SET rejection_reason = '',
       updated_at = now()
 WHERE COALESCE(rejection_reason, '') <> ''
   AND COALESCE(status, '') IS DISTINCT FROM '반려';

CREATE OR REPLACE FUNCTION public.clear_permit_rejection_reason_on_leave()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Leaving 반려 (or any non-반려 status update) must not keep the old reason
  IF NEW.status IS DISTINCT FROM '반려'
     AND COALESCE(NEW.rejection_reason, '') <> '' THEN
    NEW.rejection_reason := '';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clear_permit_rejection_reason ON public.work_permits;
CREATE TRIGGER trg_clear_permit_rejection_reason
  BEFORE UPDATE OF status ON public.work_permits
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM '반려')
  EXECUTE FUNCTION public.clear_permit_rejection_reason_on_leave();
