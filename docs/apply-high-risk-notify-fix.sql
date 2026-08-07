-- SafeNex: high-risk notify scope fix (SQL Editor paste)
-- If the full migration fails, paste THIS file only (same content, $body$ quotes).
-- Source: supabase/migrations/20260807110000_high_risk_notify_after_approval.sql

CREATE OR REPLACE FUNCTION public.is_focus_high_risk_item(
  _risk_grade text,
  _improved_risk_grade text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $body$
  SELECT (COALESCE(_risk_grade, '') = '상')
      OR (COALESCE(_improved_risk_grade, '') = '상');
$body$;

CREATE OR REPLACE FUNCTION public.ensure_high_risk_item_followup(_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  ri public.risk_items%ROWTYPE;
  _run_status text;
  _score int;
  _existing uuid;
  _todo_user uuid;
  _company_id uuid;
  _title text;
  _msg text;
BEGIN
  SELECT * INTO ri FROM public.risk_items WHERE id = _item_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(ri.is_deleted, false) OR COALESCE(ri.is_excluded, false) THEN
    RETURN;
  END IF;

  IF NOT public.is_focus_high_risk_item(ri.risk_grade, ri.improved_risk_grade) THEN
    RETURN;
  END IF;

  IF ri.run_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ar.status INTO _run_status
    FROM public.assessment_runs ar
   WHERE ar.id = ri.run_id;

  IF COALESCE(_run_status, '') <> '승인완료' THEN
    RETURN;
  END IF;

  SELECT id INTO _existing
    FROM public.todo_items
   WHERE source_table = 'risk_items'
     AND source_id = ri.id
     AND COALESCE(is_deleted, false) = false
   LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN;
  END IF;

  _todo_user := ri.assignee_user_id;

  IF _todo_user IS NULL AND ri.responsible_department_id IS NOT NULL THEN
    SELECT da.default_user_id INTO _todo_user
      FROM public.department_assignees da
     WHERE da.project_id = ri.project_id
       AND da.department_id = ri.responsible_department_id
       AND da.default_user_id IS NOT NULL
     LIMIT 1;

    IF _todo_user IS NULL THEN
      SELECT cm.user_id INTO _todo_user
        FROM public.company_managers cm
       WHERE cm.department_id = ri.responsible_department_id
         AND COALESCE(cm.is_deleted, false) = false
         AND cm.user_id IS NOT NULL
       ORDER BY cm.is_primary DESC, cm.created_at ASC
       LIMIT 1;
    END IF;
  END IF;

  IF _todo_user IS NULL THEN
    RETURN;
  END IF;

  SELECT pm.company_id INTO _company_id
    FROM public.project_members pm
   WHERE pm.project_id = ri.project_id
     AND pm.user_id = _todo_user
   LIMIT 1;

  IF _company_id IS NULL AND ri.responsible_department_id IS NOT NULL THEN
    SELECT cd.company_id INTO _company_id
      FROM public.company_departments cd
     WHERE cd.id = ri.responsible_department_id
     LIMIT 1;
  END IF;

  _score := COALESCE(ri.severity, 1) * COALESCE(ri.frequency, 1);
  _title := '[고위험/중점관리] ' || COALESCE(ri.hazard, ri.sub_task, '위험요인 조치');
  _msg := '위험등급 '
    || COALESCE(NULLIF(ri.risk_grade, ''), '?')
    || CASE
         WHEN COALESCE(ri.improved_risk_grade, '') <> ''
         THEN ' / 잔여 ' || ri.improved_risk_grade
         ELSE ''
       END
    || CASE WHEN _score > 0 THEN ' (' || _score::text || '점)' ELSE '' END
    || ' - 승인 후 조치 필요';

  INSERT INTO public.todo_items (
    project_id, user_id, company_id, title, description, due_date, status, frequency,
    source_table, source_id, category, created_at, updated_at
  ) VALUES (
    ri.project_id, _todo_user, _company_id,
    _title,
    COALESCE(ri.improvement_measure, ri.existing_measure, ''),
    (CURRENT_DATE + 14), 'pending', 'once',
    'risk_items', ri.id, 'risk_high',
    now(), now()
  );

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, related_type, related_id
  )
  SELECT DISTINCT x.user_id, ri.project_id, 'critical_alert',
         '고위험 항목 등록: ' || COALESCE(ri.hazard, '위험요인'),
         _msg,
         'risk_items', ri.id::text
    FROM (
      SELECT _todo_user AS user_id
      UNION
      SELECT pm.user_id
        FROM public.project_members pm
       WHERE pm.project_id = ri.project_id
         AND _company_id IS NOT NULL
         AND pm.company_id = _company_id
         AND pm.role_new IN ('project_admin', 'safety_manager', 'site_manager')
         AND pm.user_id IS NOT NULL
    ) x
   WHERE x.user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = x.user_id
          AND n.related_type = 'risk_items'
          AND n.related_id = ri.id::text
          AND n.type = 'critical_alert'
          AND n.created_at > (now() - interval '30 days')
     );
END;
$body$;

REVOKE ALL ON FUNCTION public.ensure_high_risk_item_followup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_high_risk_item_followup(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_high_risk_to_todo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
BEGIN
  PERFORM public.ensure_high_risk_item_followup(NEW.id);
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_risk_items_high_to_todo ON public.risk_items;
CREATE TRIGGER trg_risk_items_high_to_todo
AFTER INSERT OR UPDATE OF severity, frequency, status, risk_grade, improved_risk_grade,
  assignee_user_id, responsible_department_id, is_deleted, is_excluded
ON public.risk_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_high_risk_to_todo();

CREATE OR REPLACE FUNCTION public.trg_assessment_run_approved_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _target_names text[];
  _item_id uuid;
BEGIN
  IF NEW.status = '승인완료' AND COALESCE(OLD.status, '') <> '승인완료' THEN
    SELECT array_agg(c.name) INTO _target_names
      FROM public.companies c
     WHERE NEW.target_company_ids IS NOT NULL
       AND c.id = ANY(NEW.target_company_ids);

    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT wp.created_by, 'assessment_result',
      '위험성평가 승인 - 작업허가서 반영 필요',
      COALESCE(NEW.period_label, '위험성평가') || ' 가 승인되었습니다.',
      '/work-permits'
    FROM public.work_permits wp
    WHERE wp.project_id = NEW.project_id
      AND COALESCE(wp.is_deleted, false) = false
      AND wp.status IN ('진행중', '검토중', '대기')
      AND (
        NEW.target_company_ids IS NULL
        OR COALESCE(array_length(NEW.target_company_ids, 1), 0) = 0
        OR (_target_names IS NOT NULL AND wp.contractor_company = ANY(_target_names))
      )
      AND wp.created_by IS NOT NULL;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT ts.created_by, 'assessment_result',
      '위험성평가 승인 - TBM 브리핑 반영',
      COALESCE(NEW.period_label, '위험성평가') || ' 가 승인되었습니다.',
      '/tbm'
    FROM public.tbm_sessions ts
    WHERE ts.project_id = NEW.project_id
      AND COALESCE(ts.is_deleted, false) = false
      AND ts.is_active = true
      AND (
        NEW.target_company_ids IS NULL
        OR COALESCE(array_length(NEW.target_company_ids, 1), 0) = 0
        OR ts.company_id = ANY(NEW.target_company_ids)
      )
      AND ts.created_by IS NOT NULL;

    FOR _item_id IN
      SELECT ri.id
        FROM public.risk_items ri
       WHERE ri.run_id = NEW.id
         AND COALESCE(ri.is_deleted, false) = false
         AND COALESCE(ri.is_excluded, false) = false
         AND public.is_focus_high_risk_item(ri.risk_grade, ri.improved_risk_grade)
    LOOP
      PERFORM public.ensure_high_risk_item_followup(_item_id);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$body$;
