
-- ============================================================
-- Phase B/C dispatchers (schema-corrected)
-- ============================================================

-- B1: high-risk risk_items → todo_items + notification
CREATE OR REPLACE FUNCTION public.trg_high_risk_to_todo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _score int;
  _existing uuid;
BEGIN
  IF COALESCE(NEW.is_deleted, false) THEN RETURN NEW; END IF;
  _score := COALESCE(NEW.severity,1) * COALESCE(NEW.frequency,1);
  IF _score < 6 THEN RETURN NEW; END IF;

  SELECT id INTO _existing FROM public.todo_items
   WHERE source_table = 'risk_items' AND source_id = NEW.id
     AND COALESCE(is_deleted,false) = false LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.todo_items (
    project_id, company_id, title, description, due_date, status, frequency,
    source_table, source_id, category, created_at, updated_at
  ) VALUES (
    NEW.project_id, NULL,
    '[고위험 ' || _score || '점] ' || COALESCE(NEW.hazard, NEW.sub_task, '위험요인 조치'),
    COALESCE(NEW.improvement_measure, NEW.existing_measure, ''),
    (CURRENT_DATE + 14), 'pending', 'once',
    'risk_items', NEW.id, 'risk_high',
    now(), now()
  );

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT pm.user_id, 'critical_alert',
         '고위험 항목 등록: ' || COALESCE(NEW.hazard, '위험요인'),
         '위험도 ' || _score || '점 — 14일내 조치 필요', '/todo'
    FROM public.project_members pm
   WHERE pm.project_id = NEW.project_id
     AND pm.role_new IN ('project_admin','safety_manager','site_manager');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_risk_items_high_to_todo ON public.risk_items;
CREATE TRIGGER trg_risk_items_high_to_todo
AFTER INSERT OR UPDATE OF severity, frequency, status ON public.risk_items
FOR EACH ROW EXECUTE FUNCTION public.trg_high_risk_to_todo();

-- C3: major incidents → 24h reporting deadline (산안법 §57)
CREATE OR REPLACE FUNCTION public.trg_incident_reporting_deadline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _deadline timestamptz;
  _is_major boolean;
BEGIN
  _is_major := lower(COALESCE(NEW.severity,'')) IN ('major','critical','중대','사망','중상');
  IF NOT _is_major THEN RETURN NEW; END IF;
  _deadline := COALESCE(NEW.occurred_at, NEW.created_at, now()) + INTERVAL '24 hours';

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT pm.user_id, 'critical_alert',
         '⚠ 중대재해 24시간 신고 시한',
         '발생: ' || to_char(COALESCE(NEW.occurred_at, NEW.created_at),'YYYY-MM-DD HH24:MI')
            || E'\n시한: ' || to_char(_deadline, 'YYYY-MM-DD HH24:MI')
            || E'\n관할 노동청 신고 필요 (산안법 §57)',
         '/incidents'
    FROM public.project_members pm
   WHERE pm.project_id = NEW.project_id
     AND pm.role_new IN ('project_admin','safety_manager');

  INSERT INTO public.todo_items (
    project_id, title, description, due_date, status, frequency,
    source_table, source_id, category, created_at, updated_at
  ) VALUES (
    NEW.project_id,
    '[법정신고] 중대재해 24시간내 관할 노동청 신고',
    '산업안전보건법 §57 — 시한: ' || to_char(_deadline, 'YYYY-MM-DD HH24:MI'),
    _deadline::date, 'pending', 'once',
    'incident_reports', NEW.id, 'legal_report',
    now(), now()
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_incidents_deadline ON public.incident_reports;
CREATE TRIGGER trg_incidents_deadline
AFTER INSERT ON public.incident_reports
FOR EACH ROW EXECUTE FUNCTION public.trg_incident_reporting_deadline();

-- C2: carcinogen MSDS → auto special_health checkup target
CREATE OR REPLACE FUNCTION public.trg_carcinogen_special_checkup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _w record;
  _added int := 0;
BEGIN
  IF COALESCE(NEW.is_deleted, false) THEN RETURN NEW; END IF;
  IF NOT (COALESCE(NEW.is_carcinogen,false) OR COALESCE(NEW.is_reproductive_toxin,false)) THEN
    RETURN NEW;
  END IF;

  FOR _w IN
    SELECT w.id, w.project_id FROM public.workers w
     WHERE w.project_id = NEW.project_id AND w.is_active = true
       AND (NEW.company_id IS NULL OR w.company_id = NEW.company_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.worker_required_items wri
          WHERE wri.worker_id = w.id AND wri.item_type = 'checkup'
            AND wri.subtype = 'special_health'
            AND wri.status IN ('pending','overdue')
            AND COALESCE(wri.is_deleted,false) = false)
  LOOP
    INSERT INTO public.worker_required_items
      (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
    VALUES (_w.id, _w.project_id, 'checkup', 'special_health',
            CURRENT_DATE + 30, 'pending', 'auto',
            '산업안전보건법 시행규칙 §201 (발암성/생식독성 노출 근로자 특수건강진단)');
    _added := _added + 1;
  END LOOP;

  IF _added > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT pm.user_id, 'health_checkup_due',
           '특수건강진단 대상 자동 생성: ' || _added || '명',
           COALESCE(NEW.name, NEW.trade_name, 'MSDS') || ' 등록으로 특수건강진단 의무 발생',
           '/health/checkups'
      FROM public.project_members pm
     WHERE pm.project_id = NEW.project_id
       AND pm.role_new IN ('project_admin','safety_manager');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_chemicals_special_checkup ON public.chemicals;
CREATE TRIGGER trg_chemicals_special_checkup
AFTER INSERT OR UPDATE OF is_carcinogen, is_reproductive_toxin ON public.chemicals
FOR EACH ROW EXECUTE FUNCTION public.trg_carcinogen_special_checkup();

-- Patch: previous check_data_integrity referenced non-existent columns
CREATE OR REPLACE FUNCTION public.check_data_integrity(_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _findings jsonb := '[]'::jsonb;
  _c int;
BEGIN
  IF NOT (public.is_master(auth.uid())
          OR (_project_id IS NOT NULL AND public.is_project_member(auth.uid(), _project_id))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*) INTO _c FROM public.project_members pm
   LEFT JOIN public.profiles p ON p.user_id = pm.user_id
   WHERE p.user_id IS NULL AND (_project_id IS NULL OR pm.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','PM_PROFILE_ORPHAN','severity','high','count',_c,
    'message','project_members rows without matching profile')); END IF;

  SELECT COUNT(*) INTO _c FROM public.workers w
   WHERE w.is_active = true AND w.company_id IS NULL
     AND (_project_id IS NULL OR w.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','WORKER_NO_COMPANY','severity','medium','count',_c,
    'message','active workers without company_id')); END IF;

  SELECT COUNT(*) INTO _c FROM public.worker_entry_logs wel
   WHERE wel.daily_qr_id IS NULL
     AND (wel.entry_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
     AND (_project_id IS NULL OR wel.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','ENTRY_NO_DAILY_QR','severity','low','count',_c,
    'message','today entry logs not linked to a daily QR')); END IF;

  SELECT COUNT(*) INTO _c FROM public.project_members pm
   JOIN public.companies c ON c.id = pm.company_id
   WHERE pm.company IS NOT NULL AND pm.company <> '' AND pm.company <> c.name
     AND (_project_id IS NULL OR pm.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','PM_COMPANY_TEXT_DRIFT','severity','low','count',_c,
    'message','project_members.company text differs from companies.name')); END IF;

  -- L4 (FIXED): use severity * frequency, no risk_score column
  SELECT COUNT(*) INTO _c FROM public.risk_items ri
   WHERE COALESCE(ri.is_deleted,false) = false
     AND (COALESCE(ri.severity,1) * COALESCE(ri.frequency,1)) >= 6
     AND (_project_id IS NULL OR ri.project_id = _project_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.todo_items td
        WHERE td.source_table = 'risk_items' AND td.source_id = ri.id
          AND COALESCE(td.is_deleted,false) = false);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','HIGH_RISK_NO_TODO','severity','high','count',_c,
    'message','high risk items (>=6) without a follow-up todo')); END IF;

  SELECT COUNT(*) INTO _c FROM public.chemicals ch
   WHERE COALESCE(ch.is_deleted,false) = false
     AND (ch.is_carcinogen = true OR ch.is_reproductive_toxin = true)
     AND (_project_id IS NULL OR ch.project_id = _project_id)
     AND NOT EXISTS (SELECT 1 FROM public.health_checkups hc
        WHERE hc.project_id = ch.project_id
          AND COALESCE(hc.is_deleted,false) = false
          AND hc.type::text ILIKE '%special%');
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','CARCINOGEN_NO_SPECIAL_CHECKUP','severity','high','count',_c,
    'message','carcinogen/repro-toxin MSDS registered but no special health checkup recorded')); END IF;

  SELECT COUNT(*) INTO _c FROM (
    SELECT factor_id, MAX(measured_at) AS last_at, project_id
      FROM public.work_env_measurements
     WHERE COALESCE(is_deleted,false) = false
       AND (_project_id IS NULL OR project_id = _project_id)
     GROUP BY factor_id, project_id) s WHERE s.last_at < now() - INTERVAL '6 months';
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','ENV_MEASUREMENT_OVERDUE','severity','high','count',_c,
    'message','factors with no measurement in 6 months (시행규칙 §202)')); END IF;

  RETURN jsonb_build_object(
    'checked_at', now(), 'project_id', _project_id,
    'findings', _findings, 'total_findings', jsonb_array_length(_findings));
END; $$;

GRANT EXECUTE ON FUNCTION public.check_data_integrity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_data_integrity(uuid) TO service_role;
