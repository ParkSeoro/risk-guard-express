CREATE OR REPLACE FUNCTION public.trg_high_risk_to_todo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _score int;
  _existing uuid;
  _todo_user uuid;
BEGIN
  IF COALESCE(NEW.is_deleted, false) THEN
    RETURN NEW;
  END IF;

  _score := COALESCE(NEW.severity, 1) * COALESCE(NEW.frequency, 1);
  IF _score < 6 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO _existing
    FROM public.todo_items
   WHERE source_table = 'risk_items'
     AND source_id = NEW.id
     AND COALESCE(is_deleted, false) = false
   LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  _todo_user := COALESCE(NEW.assignee_user_id, NEW.created_by);

  IF _todo_user IS NOT NULL THEN
    INSERT INTO public.todo_items (
      project_id, user_id, company_id, title, description, due_date, status, frequency,
      source_table, source_id, category, created_at, updated_at
    ) VALUES (
      NEW.project_id, _todo_user, NULL,
      '[고위험 ' || _score || '점] ' || COALESCE(NEW.hazard, NEW.sub_task, '위험요인 조치'),
      COALESCE(NEW.improvement_measure, NEW.existing_measure, ''),
      (CURRENT_DATE + 14), 'pending', 'once',
      'risk_items', NEW.id, 'risk_high',
      now(), now()
    );
  END IF;

  INSERT INTO public.notifications (user_id, project_id, type, title, message, related_type, related_id)
  SELECT pm.user_id, NEW.project_id, 'critical_alert',
         '고위험 항목 등록: ' || COALESCE(NEW.hazard, '위험요인'),
         '위험도 ' || _score || '점 — 14일내 조치 필요',
         'risk_items', NEW.id::text
    FROM public.project_members pm
   WHERE pm.project_id = NEW.project_id
     AND pm.role_new IN ('project_admin', 'safety_manager', 'site_manager')
     AND pm.user_id IS NOT NULL;

  RETURN NEW;
END;
$function$;