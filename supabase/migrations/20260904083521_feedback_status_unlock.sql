-- Feedback (조치) 결재 최종 승인 시 assessment_runs.feedback_status 를 바꾸면
-- 이미 승인완료된 회차의 하드락(submitted_document_locked)에 걸려
-- SM 단계 UPDATE 전체가 롤백되고 대기함에 남았다.
-- 조치 상태는 본문 잠금과 별개로 갱신한다.

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
      -- feedback_status is the post-approval 조치 결재 phase; never lock it with the RA body.
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
    PERFORM set_config('app.skip_document_edit_lock', '1', true);
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
      PERFORM set_config('app.skip_document_edit_lock', '1', true);
      UPDATE public.assessment_runs
         SET feedback_status = 'closed',
             updated_at = now()
       WHERE id = NEW.entity_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
