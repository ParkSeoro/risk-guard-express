-- 상신/승인 문서 하드락: 본문 컬럼 보강, 위성 테이블 잠금, 상신 스냅샷.
-- 작업허가서 인원명단(work_permit_workers)은 발행 후에도 수정 가능 — 잠그지 않음.

-- 1) 허가서 본문 잠금 컬럼 보강 (인원명단 제외)
CREATE OR REPLACE FUNCTION public.enforce_work_permit_edit_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.skip_work_permit_edit_lock', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN (
       '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED',
       '검토대기', '검토완료', '결재중', '결재진행',
       '종료대기', '종료완료'
     ) THEN
    RAISE EXCEPTION 'WORK_PERMIT_APPROVAL_RPC_REQUIRED: 허가서 승인은 결재선으로만 처리할 수 있습니다.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(OLD.status, '') IN ('작성중', '반려', '임시저장') THEN
    RETURN NEW;
  END IF;

  IF NEW.form_data IS DISTINCT FROM OLD.form_data
     OR NEW.signatures IS DISTINCT FROM OLD.signatures
     OR NEW.work_description IS DISTINCT FROM OLD.work_description
     OR NEW.work_name IS DISTINCT FROM OLD.work_name
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.contractor_company IS DISTINCT FROM OLD.contractor_company
     OR NEW.personnel_count IS DISTINCT FROM OLD.personnel_count
     OR NEW.work_start_at IS DISTINCT FROM OLD.work_start_at
     OR NEW.work_end_at IS DISTINCT FROM OLD.work_end_at
     OR NEW.permit_type IS DISTINCT FROM OLD.permit_type
     OR NEW.permit_kinds IS DISTINCT FROM OLD.permit_kinds
     OR NEW.permit_date IS DISTINCT FROM OLD.permit_date
     OR NEW.form_template_id IS DISTINCT FROM OLD.form_template_id
     OR NEW.linked_assessment_run_ids IS DISTINCT FROM OLD.linked_assessment_run_ids
     OR NEW.assessment_run_id IS DISTINCT FROM OLD.assessment_run_id
     OR NEW.work_plan_id IS DISTINCT FROM OLD.work_plan_id
     OR NEW.ai_briefing IS DISTINCT FROM OLD.ai_briefing
     OR NEW.weather_snapshot IS DISTINCT FROM OLD.weather_snapshot
     OR NEW.extension_until IS DISTINCT FROM OLD.extension_until
  THEN
    RAISE EXCEPTION 'WORK_PERMIT_LOCKED: 결재 진행중/완료 문서는 수정할 수 없습니다. (status=%)', OLD.status
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) 리깅플랜: 부모 작업계획서가 상신되면 잠금
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

-- 3) 작업계획서 DELETE 잠금
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

-- 4) 산업안전보건관리비: 승인 후 DB 잠금
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

-- 5) 상신 스냅샷 (작성 시점 본문). 인원명단은 스냅샷에 넣지 않음(발행 후 변경 허용).
CREATE OR REPLACE FUNCTION public.snapshot_approval_document(_entity_type text, _entity_id uuid, _version int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _payload jsonb := '{}'::jsonb;
  _rigging jsonb;
  _items jsonb;
BEGIN
  IF _entity_type = 'work_permit' THEN
    SELECT to_jsonb(p) - 'weather_snapshot' INTO _payload
      FROM public.work_permits p WHERE p.id = _entity_id;
  ELSIF _entity_type = 'work_plan' THEN
    SELECT to_jsonb(p) INTO _payload FROM public.work_plans p WHERE p.id = _entity_id;
    SELECT to_jsonb(r) INTO _rigging FROM public.rigging_plans r WHERE r.work_plan_id = _entity_id;
    _payload := COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('rigging_plan', _rigging);
  ELSIF _entity_type = 'assessment_run' THEN
    SELECT to_jsonb(r) INTO _payload FROM public.assessment_runs r WHERE r.id = _entity_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at), '[]'::jsonb)
      INTO _items FROM public.risk_items i WHERE i.run_id = _entity_id;
    _payload := COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('risk_items', _items);
  ELSE
    RETURN;
  END IF;

  INSERT INTO public.document_content_snapshots (entity_type, entity_id, approval_version, payload, created_by)
  VALUES (_entity_type, _entity_id, COALESCE(_version, 1), COALESCE(_payload, '{}'::jsonb), auth.uid())
  ON CONFLICT (entity_type, entity_id, approval_version)
  DO UPDATE SET payload = EXCLUDED.payload, created_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_snapshot_on_approval_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.entity_type IN ('work_permit', 'work_plan', 'assessment_run')
     AND COALESCE(NEW.step_order, 1) = 1 THEN
    PERFORM public.snapshot_approval_document(NEW.entity_type, NEW.entity_id, NEW.approval_version);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_snapshot_on_approval_insert ON public.approvals;
CREATE TRIGGER trg_snapshot_on_approval_insert
  AFTER INSERT ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.trg_snapshot_on_approval_insert();

GRANT EXECUTE ON FUNCTION public.snapshot_approval_document(text, uuid, int) TO authenticated, service_role;
