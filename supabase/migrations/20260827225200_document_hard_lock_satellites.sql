CREATE OR REPLACE FUNCTION public.enforce_rigging_plan_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _status text;
  _plan_id uuid;
BEGIN
  IF current_setting('app.skip_document_edit_lock', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  _plan_id := COALESCE(NEW.work_plan_id, OLD.work_plan_id);
  SELECT status INTO _status FROM public.work_plans WHERE id = _plan_id;
  IF COALESCE(_status, '') NOT IN ('작성중', '반려', '') THEN
    RAISE EXCEPTION 'submitted_document_locked'
      USING ERRCODE = '42501', HINT = '상신된 작업계획서의 리깅플랜은 수정할 수 없습니다.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_lock_rigging_plans ON public.rigging_plans;
CREATE TRIGGER trg_lock_rigging_plans
  BEFORE INSERT OR UPDATE OR DELETE ON public.rigging_plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rigging_plan_lock();

CREATE OR REPLACE FUNCTION public.enforce_submitted_document_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status text;
  _locked boolean := false;
BEGIN
  IF current_setting('app.skip_document_edit_lock', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'safety_inspections' THEN
    _status := COALESCE(OLD.status, '');
    _locked := _status IN ('결재진행', 'completed');
    IF _locked AND TG_OP = 'UPDATE' THEN
      IF NEW.location IS DISTINCT FROM OLD.location
         OR NEW.summary IS DISTINCT FROM OLD.summary
         OR NEW.weather IS DISTINCT FROM OLD.weather
         OR NEW.patrol_photos IS DISTINCT FROM OLD.patrol_photos
         OR NEW.director_items IS DISTINCT FROM OLD.director_items
         OR NEW.inspector_name IS DISTINCT FROM OLD.inspector_name
         OR NEW.inspector_id IS DISTINCT FROM OLD.inspector_id
         OR NEW.inspected_at IS DISTINCT FROM OLD.inspected_at
         OR NEW.inspection_type IS DISTINCT FROM OLD.inspection_type THEN
        RAISE EXCEPTION 'submitted_document_locked'
          USING ERRCODE = '42501', HINT = '상신된 순회일지는 수정할 수 없습니다.';
      END IF;
    END IF;
    IF _locked AND TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'submitted_document_locked' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME IN ('safety_inspection_items', 'safety_inspection_actions') THEN
    SELECT status INTO _status FROM public.safety_inspections
     WHERE id = COALESCE(NEW.inspection_id, OLD.inspection_id);
    IF COALESCE(_status, '') IN ('결재진행', 'completed') THEN
      RAISE EXCEPTION 'submitted_document_locked'
        USING ERRCODE = '42501', HINT = '상신된 순회일지는 수정할 수 없습니다.';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'assessment_runs' THEN
    _status := COALESCE(OLD.status, '');
    _locked := _status IN ('결재진행', '승인완료', '승인');
    IF _locked AND TG_OP = 'UPDATE' THEN
      IF (to_jsonb(NEW) - ARRAY['status','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
        RAISE EXCEPTION 'submitted_document_locked'
          USING ERRCODE = '42501', HINT = '상신된 위험성평가는 수정할 수 없습니다.';
      END IF;
    END IF;
    IF _locked AND TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'submitted_document_locked' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'risk_items' THEN
    SELECT status INTO _status FROM public.assessment_runs WHERE id = COALESCE(NEW.run_id, OLD.run_id);
    IF COALESCE(_status, '') IN ('결재진행', '승인완료', '승인') THEN
      RAISE EXCEPTION 'submitted_document_locked'
        USING ERRCODE = '42501', HINT = '상신된 위험성평가는 수정할 수 없습니다.';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'work_plans' THEN
    _status := COALESCE(OLD.status, '');
    _locked := _status NOT IN ('작성중', '반려') AND _status <> '';
    IF _locked AND TG_OP = 'UPDATE' THEN
      IF (to_jsonb(NEW) - ARRAY['status','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
        RAISE EXCEPTION 'submitted_document_locked'
          USING ERRCODE = '42501', HINT = '상신된 작업계획서는 수정할 수 없습니다.';
      END IF;
    END IF;
    IF _locked AND TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'submitted_document_locked'
        USING ERRCODE = '42501', HINT = '상신된 작업계획서는 삭제할 수 없습니다.';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_work_plans ON public.work_plans;
CREATE TRIGGER trg_lock_work_plans
  BEFORE UPDATE OR DELETE ON public.work_plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_submitted_document_lock();

DROP TRIGGER IF EXISTS trg_lock_assessment_runs ON public.assessment_runs;
CREATE TRIGGER trg_lock_assessment_runs
  BEFORE UPDATE OR DELETE ON public.assessment_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_submitted_document_lock();

CREATE OR REPLACE FUNCTION public.enforce_safety_cost_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _status text;
  _report_id uuid;
BEGIN
  IF current_setting('app.skip_document_edit_lock', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'safety_cost_monthly_reports' THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'approved' THEN
      IF (to_jsonb(NEW) - ARRAY['updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at']) THEN
        RAISE EXCEPTION 'submitted_document_locked'
          USING ERRCODE = '42501', HINT = '승인 완료된 안전관리비 내역서는 수정할 수 없습니다.';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' AND COALESCE(OLD.status, '') = 'approved' THEN
      RAISE EXCEPTION 'submitted_document_locked'
        USING ERRCODE = '42501', HINT = '승인 완료된 안전관리비 내역서는 삭제할 수 없습니다.';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  _report_id := COALESCE(NEW.report_id, OLD.report_id);
  SELECT status INTO _status FROM public.safety_cost_monthly_reports WHERE id = _report_id;
  IF COALESCE(_status, '') = 'approved' THEN
    RAISE EXCEPTION 'submitted_document_locked'
      USING ERRCODE = '42501', HINT = '승인 완료된 안전관리비 내역서는 수정할 수 없습니다.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_lock_safety_cost_reports ON public.safety_cost_monthly_reports;
CREATE TRIGGER trg_lock_safety_cost_reports
  BEFORE UPDATE OR DELETE ON public.safety_cost_monthly_reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_safety_cost_lock();

DROP TRIGGER IF EXISTS trg_lock_safety_cost_items ON public.safety_cost_items;
CREATE TRIGGER trg_lock_safety_cost_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.safety_cost_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_safety_cost_lock();

DROP TRIGGER IF EXISTS trg_lock_safety_cost_evidence ON public.safety_cost_evidence_files;
CREATE TRIGGER trg_lock_safety_cost_evidence
  BEFORE INSERT OR UPDATE OR DELETE ON public.safety_cost_evidence_files
  FOR EACH ROW EXECUTE FUNCTION public.enforce_safety_cost_lock();
