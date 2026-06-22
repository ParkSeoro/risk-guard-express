
-- ============================================================
-- 1) 근로자 신규 등록 시 법정의무 자동 생성
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_worker_after_insert_requirements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.is_active, true) THEN
    PERFORM public.generate_worker_required_items(NEW.id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_worker_after_insert_requirements ON public.workers;
CREATE TRIGGER trg_worker_after_insert_requirements
AFTER INSERT ON public.workers
FOR EACH ROW EXECUTE FUNCTION public.trg_worker_after_insert_requirements();

-- ============================================================
-- 2) 보건교육 실시 → worker_required_items 자동 완료 + 다음 주기 생성
--    기존 trg_health_education_complete_requirement 가 있으나 트리거가 연결 안 됐을 수 있어 보강
-- ============================================================
DROP TRIGGER IF EXISTS trg_health_education_complete_requirement ON public.health_education_logs;
CREATE TRIGGER trg_health_education_complete_requirement
AFTER INSERT ON public.health_education_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_health_education_complete_requirement();

-- ============================================================
-- 3) 일일 건강일지 제출 → 당일 daily_log 의무항목 자동 완료
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_daily_health_log_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF NEW.worker_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.worker_required_items
     SET status='done', completed_at=now(),
         completed_ref_id=NEW.id, updated_at=now()
   WHERE worker_id = NEW.worker_id
     AND item_type='daily_log'
     AND status IN ('pending','overdue')
     AND due_date = _today
     AND COALESCE(is_deleted,false) = false;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_daily_health_log_complete ON public.worker_daily_health_logs;
CREATE TRIGGER trg_daily_health_log_complete
AFTER INSERT ON public.worker_daily_health_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_daily_health_log_complete();

-- ============================================================
-- 4) 안전점검 조치사항 등록 → todo_items 자동 생성
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_safety_inspection_action_todo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _insp record;
  _title text;
  _existing uuid;
BEGIN
  SELECT project_id, company_id, title INTO _insp
    FROM public.safety_inspections WHERE id = NEW.inspection_id LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  _title := '[안전점검 조치] ' || COALESCE(NEW.description, _insp.title, '조치 필요');

  SELECT id INTO _existing FROM public.todo_items
   WHERE source_table = 'safety_inspection_actions' AND source_id = NEW.id LIMIT 1;

  IF _existing IS NULL THEN
    INSERT INTO public.todo_items (
      project_id, company_id, title, description, due_date, status, frequency,
      source_table, source_id, category, assignee_user_id,
      created_at, updated_at
    ) VALUES (
      _insp.project_id, _insp.company_id, _title,
      COALESCE(NEW.description,''),
      COALESCE(NEW.due_date, CURRENT_DATE + 7),
      CASE WHEN NEW.completed_at IS NOT NULL THEN 'done' ELSE 'pending' END,
      'once',
      'safety_inspection_actions', NEW.id, 'safety_inspection',
      NEW.assignee_user_id,
      now(), now()
    );
  ELSE
    UPDATE public.todo_items
       SET title = _title,
           due_date = COALESCE(NEW.due_date, due_date),
           status = CASE WHEN NEW.completed_at IS NOT NULL THEN 'done' ELSE status END,
           completed_at = CASE WHEN NEW.completed_at IS NOT NULL THEN COALESCE(completed_at, now()) ELSE NULL END,
           updated_at = now()
     WHERE id = _existing;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_safety_inspection_action_todo ON public.safety_inspection_actions;
CREATE TRIGGER trg_safety_inspection_action_todo
AFTER INSERT OR UPDATE ON public.safety_inspection_actions
FOR EACH ROW EXECUTE FUNCTION public.trg_safety_inspection_action_todo();

-- ============================================================
-- 5) 사고 등록 → 같은 프로젝트·공종의 진행중 위험성평가 작성자/검토자에게 알림
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_incident_notify_assessment_owners()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid;
BEGIN
  FOR _u IN
    SELECT DISTINCT ar.created_by
      FROM public.assessment_runs ar
     WHERE ar.project_id = NEW.project_id
       AND COALESCE(ar.is_deleted,false) = false
       AND ar.status IN ('진행중','승인완료','보완중')
       AND (NEW.company_id IS NULL
            OR NEW.company_id = ANY(COALESCE(ar.target_company_ids, ARRAY[]::uuid[]))
            OR COALESCE(ar.target_company_ids, ARRAY[]::uuid[]) = ARRAY[]::uuid[])
  LOOP
    IF _u IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_u, 'incident',
      '사고 발생 — 위험성평가 재검토 필요',
      COALESCE(NEW.title, '사고 보고서가 등록되었습니다. 관련 위험성평가를 재검토하세요.'),
      '/incidents');
  END LOOP;

  -- 안전관리자/프로젝트관리자 알림
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT pm.user_id, 'incident',
         '사고 발생 — ' || COALESCE(NEW.title, '보고서'),
         '즉시 확인 필요',
         '/incidents'
    FROM public.project_members pm
   WHERE pm.project_id = NEW.project_id
     AND pm.role_new IN ('project_admin','safety_manager');

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_incident_notify_assessment_owners ON public.incident_reports;
CREATE TRIGGER trg_incident_notify_assessment_owners
AFTER INSERT ON public.incident_reports
FOR EACH ROW EXECUTE FUNCTION public.trg_incident_notify_assessment_owners();

-- ============================================================
-- 6) 위험성평가 승인완료 → 진행중 작업허가서·TBM 담당자에 알림
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_assessment_run_approved_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '승인완료' AND COALESCE(OLD.status,'') <> '승인완료' THEN
    -- 같은 회사 진행중 작업허가서 작성자 알림
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT wp.created_by, 'assessment_result',
      '위험성평가 승인 — 작업허가서 반영 필요',
      COALESCE(NEW.title, '') || ' 가 승인되었습니다.',
      '/work-permits'
    FROM public.work_permits wp
    WHERE wp.project_id = NEW.project_id
      AND COALESCE(wp.is_deleted, false) = false
      AND wp.status IN ('진행중','검토중','대기')
      AND (NEW.target_company_ids IS NULL
           OR COALESCE(array_length(NEW.target_company_ids,1),0) = 0
           OR wp.company_id = ANY(NEW.target_company_ids))
      AND wp.created_by IS NOT NULL;

    -- 같은 회사 진행중 TBM 리더 알림
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT ts.created_by, 'assessment_result',
      '위험성평가 승인 — TBM 브리핑 반영',
      COALESCE(NEW.title, '') || ' 가 승인되었습니다.',
      '/tbm'
    FROM public.tbm_sessions ts
    WHERE ts.project_id = NEW.project_id
      AND COALESCE(ts.is_deleted, false) = false
      AND ts.is_active = true
      AND (NEW.target_company_ids IS NULL
           OR COALESCE(array_length(NEW.target_company_ids,1),0) = 0
           OR ts.company_id = ANY(NEW.target_company_ids))
      AND ts.created_by IS NOT NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_assessment_run_approved_notify ON public.assessment_runs;
CREATE TRIGGER trg_assessment_run_approved_notify
AFTER UPDATE OF status ON public.assessment_runs
FOR EACH ROW EXECUTE FUNCTION public.trg_assessment_run_approved_notify();

-- ============================================================
-- 7) work_plans에 위험성평가 연결 컬럼 추가
-- ============================================================
ALTER TABLE public.work_plans
  ADD COLUMN IF NOT EXISTS assessment_run_id uuid REFERENCES public.assessment_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_plans_assessment_run ON public.work_plans(assessment_run_id);

-- ============================================================
-- 8) 법정의무(legal_duties) 만기 기반 자동 To-Do 생성 함수
--    (cron 함수에서 매일 호출)
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_legal_duty_todos()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d record;
  _created int := 0;
  _today date := CURRENT_DATE;
  _existing uuid;
BEGIN
  FOR _d IN
    SELECT ld.* FROM public.legal_duties ld
     WHERE COALESCE(ld.is_deleted, false) = false
       AND ld.next_due_date IS NOT NULL
       AND ld.next_due_date <= _today + INTERVAL '30 days'
  LOOP
    SELECT id INTO _existing FROM public.todo_items
     WHERE source_table = 'legal_duties' AND source_id = _d.id
       AND due_date = _d.next_due_date LIMIT 1;

    IF _existing IS NULL THEN
      INSERT INTO public.todo_items (
        project_id, company_id, title, description, due_date, status, frequency,
        source_table, source_id, category, assignee_user_id, created_at, updated_at
      ) VALUES (
        _d.project_id, _d.company_id,
        '[법정의무] ' || COALESCE(_d.title, _d.duty_type, '의무이행'),
        COALESCE(_d.description, _d.legal_basis, ''),
        _d.next_due_date,
        'pending',
        COALESCE(_d.frequency, 'once'),
        'legal_duties', _d.id, 'legal_duty',
        _d.assignee_user_id,
        now(), now()
      );
      _created := _created + 1;

      -- D-7 이내면 담당자/안전관리자에 알림
      IF _d.next_due_date <= _today + INTERVAL '7 days' AND _d.assignee_user_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (_d.assignee_user_id, 'todo_due',
          '법정의무 만기 임박 (D-' || (_d.next_due_date - _today) || ')',
          COALESCE(_d.title,'') || ' — ' || _d.next_due_date::text,
          '/todo');
      END IF;
    END IF;
  END LOOP;
  RETURN _created;
END; $$;

GRANT EXECUTE ON FUNCTION public.generate_legal_duty_todos() TO service_role;
