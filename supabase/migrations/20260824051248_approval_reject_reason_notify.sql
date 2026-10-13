-- 기안자 반려 알림(trg_approval_status_change)에 message·문서 딥링크를 채운다.
-- 앱 알림함은 message 를 보여 사유가 빠져 있었고, related_id 가 없어 원문으로 가지 못했다.

CREATE OR REPLACE FUNCTION public.trg_approval_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _creator uuid;
  _title text;
  _entity_type text;
  _entity_id uuid;
  _link text;
  _msg text;
  _reason text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('승인','반려') THEN RETURN NEW; END IF;

  _entity_type := COALESCE(NEW.entity_type, CASE WHEN NEW.run_id IS NOT NULL THEN 'assessment_run' END);
  _entity_id := COALESCE(NEW.entity_id, NEW.run_id);

  IF NEW.run_id IS NOT NULL THEN
    SELECT created_by INTO _creator FROM public.assessment_runs WHERE id = NEW.run_id;
  ELSIF NEW.risk_item_id IS NOT NULL THEN
    SELECT created_by INTO _creator FROM public.risk_items WHERE id = NEW.risk_item_id;
  ELSIF _entity_type = 'assessment_run' AND _entity_id IS NOT NULL THEN
    SELECT created_by INTO _creator FROM public.assessment_runs WHERE id = _entity_id;
  END IF;
  IF _creator IS NULL THEN RETURN NEW; END IF;

  _reason := btrim(COALESCE(NEW.comment, ''));
  _title := CASE WHEN NEW.status = '승인' THEN '결재 승인됨' ELSE '결재 반려됨' END
            || ': ' || COALESCE(NEW.step, '');
  IF NEW.status = '반려' AND _reason <> '' THEN
    _msg := '사유: ' || _reason;
  ELSE
    _msg := _reason;
  END IF;

  _link := CASE
    WHEN _entity_type = 'assessment_run' AND _entity_id IS NOT NULL
      THEN '/assessment-run/' || _entity_id::text
    WHEN _entity_type = 'work_plan' AND _entity_id IS NOT NULL
      THEN '/work-plan/' || _entity_id::text
    WHEN _entity_type = 'work_permit' AND _entity_id IS NOT NULL
      THEN '/work-permits/' || _entity_id::text
    ELSE '/approvals'
  END;

  INSERT INTO public.notifications
    (user_id, project_id, type, title, message, body, link, related_type, related_id, is_read)
  VALUES
    (_creator, NEW.project_id,
     CASE WHEN NEW.status = '승인' THEN 'approval_approved' ELSE 'approval_rejected' END,
     _title, _msg, COALESCE(NEW.comment, ''), _link,
     _entity_type, _entity_id::text, false);
  RETURN NEW;
END;
$$;
