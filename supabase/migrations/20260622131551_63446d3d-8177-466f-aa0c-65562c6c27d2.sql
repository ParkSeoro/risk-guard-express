
-- A) 만 65세/유소견자 자동 플래그
CREATE OR REPLACE FUNCTION public.trg_worker_daily_log_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _age int;
BEGIN
  _age := CASE WHEN NEW.birth_date IS NULL THEN NULL
               ELSE date_part('year', age(CURRENT_DATE, NEW.birth_date))::int END;
  NEW.requires_daily_health_log :=
    (COALESCE(_age,0) >= 65)
    OR COALESCE(NEW.health_grade,'') IN ('D1','D2')
    OR COALESCE(NEW.health_checkup_status,'') IN ('유소견D1','유소견D2');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_worker_daily_log_flag ON public.workers;
CREATE TRIGGER trg_worker_daily_log_flag
  BEFORE INSERT OR UPDATE OF birth_date, health_grade, health_checkup_status
  ON public.workers
  FOR EACH ROW EXECUTE FUNCTION public.trg_worker_daily_log_flag();

-- B) 근로자 의무사항 자동 생성
CREATE OR REPLACE FUNCTION public.generate_worker_required_items(_worker_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _w record;
  _m record;
  _base date;
  _due date;
  _count int := 0;
  _job text;
  _has_hazardous boolean;
BEGIN
  SELECT * INTO _w FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND OR COALESCE(_w.is_active,true) = false THEN RETURN 0; END IF;

  _job := COALESCE(_w.job_type, 'general');
  _has_hazardous := array_length(COALESCE(_w.assigned_chemicals, ARRAY[]::uuid[]), 1) > 0;
  _base := COALESCE(_w.hire_date, CURRENT_DATE);

  -- 적용 매핑: 시스템 기본 + 프로젝트 오버라이드 (프로젝트 우선)
  FOR _m IN
    WITH ranked AS (
      SELECT m.*,
        ROW_NUMBER() OVER (
          PARTITION BY m.job_type, m.education_type
          ORDER BY (m.project_id IS NOT NULL) DESC, m.updated_at DESC
        ) AS rn
      FROM public.worker_legal_education_mapping m
      WHERE COALESCE(m.is_deleted,false) = false
        AND (m.project_id IS NULL OR m.project_id = _w.project_id)
        AND (
          m.job_type = _job
          OR (_has_hazardous AND m.job_type IN ('hazardous','chemical'))
          OR (m.job_type = 'general' AND _job NOT IN ('office','manager'))
        )
    )
    SELECT * FROM ranked WHERE rn = 1
  LOOP
    _due := _base + COALESCE(_m.first_due_days, 0);

    -- 이미 존재(pending 또는 done)하는 동일 subtype 중복 방지 — pending이 있으면 skip
    IF EXISTS (
      SELECT 1 FROM public.worker_required_items
      WHERE worker_id = _worker_id
        AND item_type = CASE WHEN _m.education_type LIKE '%health' THEN 'checkup' ELSE 'education' END
        AND subtype = _m.education_type
        AND status = 'pending'
        AND COALESCE(is_deleted,false) = false
    ) THEN CONTINUE; END IF;

    INSERT INTO public.worker_required_items
      (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
    VALUES (
      _worker_id, _w.project_id,
      CASE WHEN _m.education_type LIKE '%health' THEN 'checkup' ELSE 'education' END,
      _m.education_type, _due, 'pending', 'auto', _m.legal_basis
    );
    _count := _count + 1;
  END LOOP;

  -- 일일 건강일지 대상 표시 (행은 매일 cron이 생성)
  IF _w.requires_daily_health_log AND NOT EXISTS (
    SELECT 1 FROM public.worker_required_items
    WHERE worker_id = _worker_id AND item_type = 'daily_log' AND status = 'pending'
      AND due_date = CURRENT_DATE AND COALESCE(is_deleted,false) = false
  ) THEN
    INSERT INTO public.worker_required_items
      (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
    VALUES (_worker_id, _w.project_id, 'daily_log',
      CASE WHEN COALESCE(_w.health_grade,'') IN ('D1','D2')
              OR COALESCE(_w.health_checkup_status,'') IN ('유소견D1','유소견D2')
           THEN 'health_d' ELSE 'age65' END,
      CURRENT_DATE, 'pending', 'auto',
      '산업안전보건법 제129조 / 고령자 건강관리 지침');
    _count := _count + 1;
  END IF;

  RETURN _count;
END; $$;

-- C) workers AFTER INSERT/UPDATE → 의무 자동 생성
CREATE OR REPLACE FUNCTION public.trg_worker_auto_requirements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.generate_worker_required_items(NEW.id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_worker_auto_requirements ON public.workers;
CREATE TRIGGER trg_worker_auto_requirements
  AFTER INSERT OR UPDATE OF job_type, hire_date, assigned_chemicals, requires_daily_health_log, birth_date, health_grade
  ON public.workers
  FOR EACH ROW EXECUTE FUNCTION public.trg_worker_auto_requirements();

-- D) 건강진단 완료 시 의무 완료 + 다음 주기 생성
CREATE OR REPLACE FUNCTION public.trg_health_checkup_complete_requirement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _subtype text;
  _interval int;
  _mapping record;
  _w record;
BEGIN
  IF NEW.worker_id IS NULL OR NEW.conducted_date IS NULL THEN RETURN NEW; END IF;

  _subtype := CASE WHEN COALESCE(NEW.type::text,'general') ILIKE '%special%'
                     OR NEW.type::text IN ('특수','특수건강진단')
                   THEN 'special_health' ELSE 'general_health' END;

  -- 가장 가까운 pending 의무 완료 처리
  UPDATE public.worker_required_items
    SET status='done', completed_at=now(), completed_ref_id=NEW.id, updated_at=now()
  WHERE worker_id = NEW.worker_id AND item_type = 'checkup' AND subtype = _subtype
    AND status = 'pending' AND COALESCE(is_deleted,false) = false;

  -- 다음 주기 행 자동 생성
  SELECT * INTO _w FROM public.workers WHERE id = NEW.worker_id;
  IF _w IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO _mapping FROM public.worker_legal_education_mapping
   WHERE education_type = _subtype
     AND (project_id IS NULL OR project_id = _w.project_id)
     AND COALESCE(is_deleted,false) = false
   ORDER BY (project_id IS NOT NULL) DESC, updated_at DESC LIMIT 1;

  _interval := COALESCE(_mapping.interval_months, 12);

  INSERT INTO public.worker_required_items
    (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
  VALUES (NEW.worker_id, _w.project_id, 'checkup', _subtype,
          (NEW.conducted_date + (_interval || ' months')::interval)::date,
          'pending', 'auto', _mapping.legal_basis);

  -- workers 본인 동기화 (기존 sync_worker_health_status 트리거가 추가로 동작)
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_health_checkup_req ON public.health_checkups;
CREATE TRIGGER trg_health_checkup_req
  AFTER INSERT OR UPDATE OF conducted_date, result
  ON public.health_checkups
  FOR EACH ROW EXECUTE FUNCTION public.trg_health_checkup_complete_requirement();

-- E) 보건교육 완료 시 의무 완료 + 다음 주기 생성 (worker별)
CREATE OR REPLACE FUNCTION public.trg_health_education_complete_requirement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _subtype text := 'regular';
  _interval int := 3;
  _w record;
BEGIN
  -- worker_id 컬럼이 있고, 값이 있을 때만 동작
  IF to_jsonb(NEW) ? 'worker_id' = false THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW)->>'worker_id') IS NULL THEN RETURN NEW; END IF;

  UPDATE public.worker_required_items
    SET status='done', completed_at=now(),
        completed_ref_id=NEW.id, updated_at=now()
  WHERE worker_id = (to_jsonb(NEW)->>'worker_id')::uuid
    AND item_type='education' AND status='pending'
    AND COALESCE(is_deleted,false) = false
    AND subtype IN ('new_hire','regular','special','manager');

  SELECT * INTO _w FROM public.workers WHERE id = (to_jsonb(NEW)->>'worker_id')::uuid;
  IF _w IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.worker_required_items
    (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
  VALUES (_w.id, _w.project_id, 'education', _subtype,
          (CURRENT_DATE + (_interval || ' months')::interval)::date,
          'pending', 'auto', '산업안전보건법 시행규칙 [별표4]');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_health_education_req ON public.health_education_logs;
CREATE TRIGGER trg_health_education_req
  AFTER INSERT ON public.health_education_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_health_education_complete_requirement();

-- F) overdue 자동 갱신 함수 (cron에서 호출)
CREATE OR REPLACE FUNCTION public.mark_required_items_overdue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c int;
BEGIN
  UPDATE public.worker_required_items
     SET status='overdue', updated_at=now()
   WHERE status='pending' AND due_date < CURRENT_DATE
     AND COALESCE(is_deleted,false) = false;
  GET DIAGNOSTICS _c = ROW_COUNT;
  RETURN _c;
END; $$;
