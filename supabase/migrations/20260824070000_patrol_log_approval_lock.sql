-- 순회일지: 날씨·순회사진·관리책임자 3항목·상신 스냅샷
-- 결재 상신본 전역 잠금 (순회 완전 / 위평·계획서 DB 잠금)

ALTER TABLE public.safety_inspections
  ADD COLUMN IF NOT EXISTS weather text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS patrol_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS director_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_payload jsonb;

CREATE TABLE IF NOT EXISTS public.document_content_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  approval_version int NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, approval_version)
);

ALTER TABLE public.document_content_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read document snapshots" ON public.document_content_snapshots;
CREATE POLICY "members read document snapshots"
  ON public.document_content_snapshots FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.document_content_snapshots TO authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_safety_inspection(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ins jsonb;
  _items jsonb;
  _actions jsonb;
  _payload jsonb;
  _ver int;
BEGIN
  SELECT to_jsonb(s.*) INTO _ins FROM public.safety_inspections s WHERE s.id = _id;
  IF _ins IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(i.*) ORDER BY i.sort_order), '[]'::jsonb)
    INTO _items FROM public.safety_inspection_items i WHERE i.inspection_id = _id;
  SELECT COALESCE(jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at), '[]'::jsonb)
    INTO _actions FROM public.safety_inspection_actions a WHERE a.inspection_id = _id;

  _payload := jsonb_build_object(
    'inspection', _ins,
    'items', _items,
    'actions', _actions,
    'captured_at', now()
  );

  SELECT COALESCE(MAX(approval_version), 1) INTO _ver
    FROM public.approvals
   WHERE entity_type = 'safety_inspection' AND entity_id = _id;
  IF _ver IS NULL OR _ver < 1 THEN _ver := 1; END IF;

  INSERT INTO public.document_content_snapshots (entity_type, entity_id, approval_version, payload, created_by)
  VALUES ('safety_inspection', _id, _ver, _payload, auth.uid())
  ON CONFLICT (entity_type, entity_id, approval_version)
  DO UPDATE SET payload = EXCLUDED.payload;

  UPDATE public.safety_inspections
     SET submitted_payload = _payload,
         submitted_at = COALESCE(submitted_at, now()),
         updated_at = now()
   WHERE id = _id;

  RETURN _payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_safety_inspection_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pending int;
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'safety_inspection' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.skip_document_edit_lock', '1', true);

  IF TG_OP = 'INSERT' THEN
    PERFORM public.snapshot_safety_inspection(NEW.entity_id);
    UPDATE public.safety_inspections
       SET status = '결재진행', updated_at = now()
     WHERE id = NEW.entity_id
       AND COALESCE(status, '') NOT IN ('completed');
  END IF;

  IF NEW.status = '반려' THEN
    UPDATE public.safety_inspections
       SET status = '반려', updated_at = now()
     WHERE id = NEW.entity_id;
  END IF;

  IF NEW.status = '승인' THEN
    SELECT COUNT(*) INTO _pending
      FROM public.approvals
     WHERE entity_type = 'safety_inspection'
       AND entity_id = NEW.entity_id
       AND approval_version = NEW.approval_version
       AND status IN ('대기', '진행중');
    IF COALESCE(_pending, 0) = 0 THEN
      UPDATE public.safety_inspections
         SET status = 'completed', updated_at = now()
       WHERE id = NEW.entity_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_safety_inspection_approval ON public.approvals;
CREATE TRIGGER trg_sync_safety_inspection_approval
  AFTER INSERT OR UPDATE OF status ON public.approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_safety_inspection_approval();

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
    RETURN COALESCE(NEW, OLD);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_safety_inspections ON public.safety_inspections;
CREATE TRIGGER trg_lock_safety_inspections
  BEFORE UPDATE OR DELETE ON public.safety_inspections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_submitted_document_lock();

DROP TRIGGER IF EXISTS trg_lock_safety_inspection_items ON public.safety_inspection_items;
CREATE TRIGGER trg_lock_safety_inspection_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.safety_inspection_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_submitted_document_lock();

DROP TRIGGER IF EXISTS trg_lock_safety_inspection_actions ON public.safety_inspection_actions;
CREATE TRIGGER trg_lock_safety_inspection_actions
  BEFORE INSERT OR UPDATE OR DELETE ON public.safety_inspection_actions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_submitted_document_lock();

DROP TRIGGER IF EXISTS trg_lock_assessment_runs ON public.assessment_runs;
CREATE TRIGGER trg_lock_assessment_runs
  BEFORE UPDATE ON public.assessment_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_submitted_document_lock();

DROP TRIGGER IF EXISTS trg_lock_risk_items ON public.risk_items;
CREATE TRIGGER trg_lock_risk_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.risk_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_submitted_document_lock();

DROP TRIGGER IF EXISTS trg_lock_work_plans ON public.work_plans;
CREATE TRIGGER trg_lock_work_plans
  BEFORE UPDATE ON public.work_plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_submitted_document_lock();

-- 결재선 draft 잠금: 순회 결재중이면 수정 불가
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
  SELECT status INTO _st FROM public.safety_inspections WHERE id = NEW.entity_id;
  IF COALESCE(_st, '') IN ('결재진행', 'completed') AND COALESCE(OLD.status, '') = 'submitted' THEN
    RAISE EXCEPTION 'draft_locked_while_in_approval';
  END IF;
  RETURN NEW;
END;
$$;
