-- assessment_feedback_chain returns previous_run_id, which is also a column
-- on assessment_runs. Selecting that name crashed the lookup (42702) whenever
-- a previous week existed, so every company saw an empty picker.
-- Choose the previous week by period inside the existing pick function.
-- The typed title is not used.

CREATE OR REPLACE FUNCTION public.assessment_feedback_chain(
  _run_id uuid,
  _override_previous_id uuid DEFAULT NULL
)
RETURNS TABLE (
  previous_run_id uuid,
  previous_of_previous_run_id uuid,
  auto_previous_run_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _current public.assessment_runs;
  _prev public.assessment_runs;
  _role text;
  _chosen uuid;
  _auto uuid;
  _older uuid;
BEGIN
  SELECT * INTO _current FROM public.assessment_runs WHERE id = _run_id;
  IF NOT FOUND OR COALESCE(_current.is_deleted, false) THEN
    RETURN;
  END IF;

  _role := COALESCE(auth.role(), '');
  IF _role IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR NOT public.can_read_assessment_run(_current, auth.uid()) THEN
      RETURN;
    END IF;
  END IF;

  _auto := public.pick_previous_approved_assessment_run(_current);
  _chosen := public.resolve_assessment_previous_run(_current, _override_previous_id);
  _older := NULL;
  IF _chosen IS NOT NULL THEN
    SELECT * INTO _prev FROM public.assessment_runs WHERE id = _chosen;
    IF FOUND THEN
      _older := public.pick_previous_approved_assessment_run(_prev);
    END IF;
  END IF;

  previous_run_id := _chosen;
  previous_of_previous_run_id := _older;
  auto_previous_run_id := _auto;
  RETURN NEXT;
END;
$fn$;
