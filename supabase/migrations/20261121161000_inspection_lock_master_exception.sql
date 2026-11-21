-- Batch 2 (#7): completed / 결재진행 inspections are hard-locked for every role.
-- Master (user_roles.role = master) is the only exception, matching the UI helper
-- isInspectionEditLocked. Korean legacy statuses 완료 / 승인완료 join the lock set,
-- and soft-delete (is_deleted) is included so the UI delete lock is not bypassable.

CREATE OR REPLACE FUNCTION public.enforce_submitted_document_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _status text;
  _locked boolean := false;
BEGIN
  IF current_setting('app.skip_document_edit_lock', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF public.is_master(auth.uid()) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'safety_inspections' THEN
    _status := COALESCE(OLD.status, '');
    _locked := _status IN ('결재진행', 'completed', '완료', '승인완료');
    IF _locked AND TG_OP = 'UPDATE' THEN
      IF NEW.location IS DISTINCT FROM OLD.location
         OR NEW.summary IS DISTINCT FROM OLD.summary
         OR NEW.weather IS DISTINCT FROM OLD.weather
         OR NEW.patrol_photos IS DISTINCT FROM OLD.patrol_photos
         OR NEW.director_items IS DISTINCT FROM OLD.director_items
         OR NEW.form_payload IS DISTINCT FROM OLD.form_payload
         OR NEW.inspector_name IS DISTINCT FROM OLD.inspector_name
         OR NEW.inspector_id IS DISTINCT FROM OLD.inspector_id
         OR NEW.inspected_at IS DISTINCT FROM OLD.inspected_at
         OR NEW.inspection_type IS DISTINCT FROM OLD.inspection_type
         OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
        RAISE EXCEPTION 'submitted_document_locked'
          USING ERRCODE = '42501', HINT = '상신된 점검표는 수정할 수 없습니다.';
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
    IF COALESCE(_status, '') IN ('결재진행', 'completed', '완료', '승인완료') THEN
      RAISE EXCEPTION 'submitted_document_locked'
        USING ERRCODE = '42501', HINT = '상신된 점검표는 수정할 수 없습니다.';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'assessment_runs' THEN
    _status := COALESCE(OLD.status, '');
    _locked := _status IN ('결재진행', '승인완료', '승인');
    IF _locked AND TG_OP = 'UPDATE' THEN
      IF (to_jsonb(NEW) - ARRAY['status','updated_at','feedback_status'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at','feedback_status']) THEN
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
$function$;

-- Submitted approval drafts stay locked for everyone except master,
-- matching the detail screen (readOnly follows isInspectionEditLocked).
CREATE OR REPLACE FUNCTION public.trg_lock_inspection_approval_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _st text;
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'safety_inspection' THEN
    RETURN NEW;
  END IF;
  IF public.is_master(auth.uid()) THEN
    RETURN NEW;
  END IF;
  SELECT status INTO _st FROM public.safety_inspections WHERE id = NEW.entity_id;
  IF COALESCE(_st, '') IN ('결재진행', 'completed', '완료', '승인완료')
     AND COALESCE(OLD.status, '') = 'submitted' THEN
    RAISE EXCEPTION 'draft_locked_while_in_approval';
  END IF;
  RETURN NEW;
END;
$$;
