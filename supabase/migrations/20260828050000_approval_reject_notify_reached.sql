-- 반려 알림: 기안자 + 이미 승인한 앞단계만. 아직 요청이 안 간 대기 윗단계는 제외.
-- 최종 승인은 기존처럼 취소가 아닌 결재선(+기안자). 산안비는 created_by/submitted_by를 기안자로 본다.

CREATE OR REPLACE FUNCTION public.trg_approval_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  _entity_label text;
  _entity_link text;
  _creator uuid;
  _all_done boolean;
  _target_id uuid;
  _entity_type text;
  _entity_id uuid;
  _doc_title text;
  _msg text;
  _title text;
  _severity text;
BEGIN
  _entity_type := COALESCE(NEW.entity_type, TG_ARGV[0]);
  _entity_id   := COALESCE(NEW.entity_id, NEW.run_id);

  _entity_label := CASE _entity_type
    WHEN 'work_plan' THEN '작업계획서'
    WHEN 'work_permit' THEN '작업허가서'
    WHEN 'assessment_run' THEN '위험성평가'
    WHEN 'safety_cost' THEN '산업안전보건관리비'
    WHEN 'incident' THEN '사고보고'
    WHEN 'emergency_drill' THEN '비상대피훈련'
    WHEN 'tbm' THEN 'TBM 일지'
    ELSE COALESCE(_entity_type,'문서') END;

  _entity_link := CASE _entity_type
    WHEN 'work_plan'      THEN '/work-plan/' || COALESCE(_entity_id::text,'')
    WHEN 'work_permit'    THEN '/app/worker/approvals'
    WHEN 'assessment_run' THEN '/assessment-run/' || COALESCE(_entity_id::text,'')
    WHEN 'safety_cost'    THEN '/safety-cost'
    WHEN 'incident'       THEN '/incidents'
    WHEN 'emergency_drill' THEN '/emergency-drills'
    WHEN 'tbm'            THEN '/tbm-logs'
    ELSE '/approvals' END;

  _doc_title := NULL;
  IF _entity_type = 'work_permit' THEN
    SELECT COALESCE(NULLIF(work_name,''), NULLIF(work_description,''), '작업허가서')
      INTO _doc_title FROM public.work_permits WHERE id = _entity_id;
  ELSIF _entity_type = 'work_plan' THEN
    SELECT title INTO _doc_title FROM public.work_plans WHERE id = _entity_id;
  END IF;
  _doc_title := COALESCE(_doc_title, _entity_label);

  IF lower(COALESCE(NEW.position,'')) = 'closure_sm' THEN
    _msg := '결재 요청: ' || _doc_title || ' 허가서의 작업 완료 확인이 필요합니다.';
  ELSE
    _msg := '결재 요청: ' || _doc_title || ' 허가서가 도착했습니다.';
    IF _entity_type <> 'work_permit' THEN
      _msg := '결재 요청: ' || _doc_title || '이(가) 도착했습니다.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = '진행중' AND NEW.approver_id IS NOT NULL THEN
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES
        (NEW.approver_id, NEW.project_id, 'approval_request',
         CASE WHEN lower(COALESCE(NEW.position,'')) = 'closure_sm'
              THEN '작업 완료 확인 요망' ELSE _entity_label || ' 결재 요청' END,
         _msg, _msg,
         _entity_type, _entity_id::text, _entity_link, false);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = '진행중'
       AND NEW.approver_id IS NOT NULL THEN
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES
        (NEW.approver_id, NEW.project_id, 'approval_request',
         CASE WHEN lower(COALESCE(NEW.position,'')) = 'closure_sm'
              THEN '작업 완료 확인 요망' ELSE _entity_label || ' 결재 요청' END,
         _msg, _msg,
         _entity_type, _entity_id::text, _entity_link, false);
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('반려', '승인') THEN
      _creator := NULL;
      IF _entity_type = 'work_plan' THEN
        SELECT created_by INTO _creator FROM public.work_plans WHERE id = _entity_id;
      ELSIF _entity_type = 'work_permit' THEN
        SELECT created_by INTO _creator FROM public.work_permits WHERE id = _entity_id;
      ELSIF _entity_type = 'assessment_run' THEN
        BEGIN SELECT created_by INTO _creator FROM public.assessment_runs WHERE id = _entity_id;
        EXCEPTION WHEN OTHERS THEN _creator := NULL; END;
      ELSIF _entity_type = 'safety_cost' THEN
        SELECT COALESCE(created_by, submitted_by) INTO _creator
          FROM public.safety_cost_monthly_reports WHERE id = _entity_id;
      END IF;

      IF NEW.status = '반려' THEN
        _title := _entity_label || ' 반려';
        _severity := 'warning';
        _msg := _doc_title || '이(가) 반려되었습니다.';
        IF btrim(COALESCE(NEW.comment, '')) <> '' THEN
          _msg := _msg || E'\n사유: ' || btrim(NEW.comment);
        END IF;
      ELSE
        SELECT NOT EXISTS (
          SELECT 1 FROM public.approvals
           WHERE entity_type = _entity_type AND entity_id = _entity_id
             AND approval_version = NEW.approval_version
             AND status IN ('대기','진행중')
        ) INTO _all_done;
        IF NOT _all_done OR lower(COALESCE(NEW.position,'')) = 'closure_sm' THEN
          RETURN NEW;
        END IF;
        _title := _entity_label || ' 최종 승인';
        _severity := NULL;
        _msg := _doc_title || '이(가) 최종 승인되었습니다.';
      END IF;

      FOR _target_id IN
        SELECT DISTINCT uid FROM (
          SELECT a.approver_id AS uid
            FROM public.approvals a
           WHERE a.entity_type = _entity_type
             AND a.entity_id = _entity_id
             AND a.approval_version = NEW.approval_version
             AND a.approver_id IS NOT NULL
             AND (
               (NEW.status = '반려' AND a.status = '승인')
               OR (NEW.status = '승인' AND COALESCE(a.status, '') <> '취소')
             )
          UNION
          SELECT _creator
           WHERE _creator IS NOT NULL
        ) s
        WHERE uid IS NOT NULL
          AND uid IS DISTINCT FROM NEW.approver_id
      LOOP
        INSERT INTO public.notifications
          (user_id, project_id, type, title, message, body, related_type, related_id, link, severity, is_read)
        VALUES
          (_target_id, NEW.project_id, 'approval_result',
           _title, _msg, _msg,
           _entity_type, _entity_id::text, _entity_link, _severity, false);
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
