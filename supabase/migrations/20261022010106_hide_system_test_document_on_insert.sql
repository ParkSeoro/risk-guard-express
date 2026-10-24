CREATE OR REPLACE FUNCTION public.hide_system_test_documents(_run_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  RETURN public.hide_system_test_documents_apply(_run_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.hide_system_test_documents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hide_system_test_documents(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.hide_system_test_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  marker text;
BEGIN
  marker := CASE TG_TABLE_NAME
    WHEN 'assessment_runs' THEN NEW.period_label
    WHEN 'work_plans' THEN NEW.title
    WHEN 'work_permits' THEN COALESCE(NULLIF(NEW.work_name, ''), NEW.work_description)
    WHEN 'tbm_sessions' THEN NEW.title
    WHEN 'risk_items' THEN NEW.process
    ELSE NULL
  END;

  IF starts_with(COALESCE(marker, ''), '__QA__') THEN
    NEW.is_deleted := true;
    IF NEW.deleted_at IS NULL THEN
      NEW.deleted_at := now();
    END IF;
    IF NULLIF(btrim(COALESCE(NEW.deleted_reason, '')), '') IS NULL THEN
      NEW.deleted_reason := '시스템 테스트 문서';
    END IF;
    IF NEW.deleted_by IS NULL THEN
      NEW.deleted_by := auth.uid();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.assessment_runs;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.assessment_runs
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.work_plans;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.work_plans
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.work_permits;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.work_permits
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.tbm_sessions;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.tbm_sessions
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.risk_items;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.risk_items
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();