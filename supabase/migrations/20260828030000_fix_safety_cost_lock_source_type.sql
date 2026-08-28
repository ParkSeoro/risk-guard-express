-- enforce_safety_cost_lock is shared across reports/items/evidence/ppe movements.
-- NEW.source_type only exists on ppe movements; accessing it on evidence_files
-- raises: record "new" has no field "source_type"

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
  _source_type text;
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

  _report_id := COALESCE(
    (to_jsonb(NEW)->>'report_id')::uuid,
    (to_jsonb(OLD)->>'report_id')::uuid
  );
  IF _report_id IS NOT NULL THEN
    SELECT status INTO _status FROM public.safety_cost_monthly_reports WHERE id = _report_id;
    _locked := COALESCE(_status, '') IN ('submitted', 'approved');
  END IF;

  IF TG_TABLE_NAME IN ('safety_cost_items', 'safety_cost_evidence_files') AND _locked THEN
    RAISE EXCEPTION 'submitted_document_locked'
      USING ERRCODE = '42501', HINT = '상신·승인된 안전관리비 내역서는 수정할 수 없습니다.';
  END IF;

  _source_type := COALESCE(to_jsonb(NEW)->>'source_type', to_jsonb(OLD)->>'source_type', '');
  IF TG_TABLE_NAME = 'safety_cost_ppe_stock_movements' AND _locked
     AND _source_type IN ('item', 'import') THEN
    RAISE EXCEPTION 'submitted_document_locked'
      USING ERRCODE = '42501', HINT = '상신·승인된 월의 보호구 입고 수불은 수정할 수 없습니다.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
