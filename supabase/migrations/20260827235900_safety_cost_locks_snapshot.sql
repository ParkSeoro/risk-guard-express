CREATE OR REPLACE FUNCTION public.enforce_safety_cost_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _status text;
  _report_id uuid;
  _locked boolean := false;
BEGIN
  IF current_setting('app.skip_document_edit_lock', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'safety_cost_monthly_reports' THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') IN ('submitted', 'approved') THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         AND NEW.status IN ('approved', 'rejected', 'submitted', 'draft') THEN
        RETURN NEW;
      END IF;
      IF (to_jsonb(NEW) - ARRAY['updated_at', 'report_total', 'status', 'approved_by', 'approved_at', 'submitted_by', 'submitted_at'])
         IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['updated_at', 'report_total', 'status', 'approved_by', 'approved_at', 'submitted_by', 'submitted_at'])
      THEN
        RAISE EXCEPTION 'submitted_document_locked'
          USING ERRCODE = '42501', HINT = '상신·승인된 안전관리비 내역서는 수정할 수 없습니다.';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' AND COALESCE(OLD.status, '') IN ('submitted', 'approved') THEN
      RAISE EXCEPTION 'submitted_document_locked'
        USING ERRCODE = '42501', HINT = '상신·승인된 안전관리비 내역서는 삭제할 수 없습니다.';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  _report_id := COALESCE(NEW.report_id, OLD.report_id);
  IF _report_id IS NOT NULL THEN
    SELECT status INTO _status FROM public.safety_cost_monthly_reports WHERE id = _report_id;
    _locked := COALESCE(_status, '') IN ('submitted', 'approved');
  END IF;

  IF TG_TABLE_NAME IN ('safety_cost_items', 'safety_cost_evidence_files') AND _locked THEN
    RAISE EXCEPTION 'submitted_document_locked'
      USING ERRCODE = '42501', HINT = '상신·승인된 안전관리비 내역서는 수정할 수 없습니다.';
  END IF;

  IF TG_TABLE_NAME = 'safety_cost_ppe_stock_movements' AND _locked
     AND COALESCE(COALESCE(NEW.source_type, OLD.source_type), '') IN ('item', 'import') THEN
    RAISE EXCEPTION 'submitted_document_locked'
      USING ERRCODE = '42501', HINT = '상신·승인된 월의 보호구 입고 수불은 수정할 수 없습니다.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_lock_safety_cost_ppe_movements ON public.safety_cost_ppe_stock_movements;
CREATE TRIGGER trg_lock_safety_cost_ppe_movements
  BEFORE INSERT OR UPDATE OR DELETE ON public.safety_cost_ppe_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_safety_cost_lock();

CREATE OR REPLACE FUNCTION public.enforce_safety_cost_budget_floor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_approved numeric;
  v_is_master boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.safety_cost_total, 0) >= COALESCE(OLD.safety_cost_total, 0) THEN RETURN NEW; END IF;
  v_approved := public.safety_cost_approved_cumulative(NEW.id);
  IF NEW.safety_cost_total + 1 >= v_approved THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'
  ) INTO v_is_master;
  IF NOT COALESCE(v_is_master, false) THEN
    RAISE EXCEPTION 'budget_below_approved'
      USING ERRCODE = '42501', HINT = '승인 누계보다 계상액을 낮출 수 없습니다.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_safety_cost_budget_floor ON public.safety_cost_constructions;
CREATE TRIGGER trg_safety_cost_budget_floor
  BEFORE UPDATE ON public.safety_cost_constructions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_safety_cost_budget_floor();

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
  ELSIF _entity_type = 'safety_cost' THEN
    SELECT to_jsonb(r) INTO _payload FROM public.safety_cost_monthly_reports r WHERE r.id = _entity_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at), '[]'::jsonb)
      INTO _items FROM public.safety_cost_items i
     WHERE i.report_id = _entity_id AND COALESCE(i.is_deleted, false) = false;
    _payload := COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('items', _items);
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
  IF NEW.entity_type IN ('work_permit', 'work_plan', 'assessment_run', 'safety_cost')
     AND COALESCE(NEW.step_order, 1) = 1 THEN
    PERFORM public.snapshot_approval_document(NEW.entity_type, NEW.entity_id, NEW.approval_version);
  END IF;
  RETURN NEW;
END;
$function$;
