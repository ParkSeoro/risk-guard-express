CREATE OR REPLACE FUNCTION public.trg_assessment_run_approved_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _target_names text[];
  _item_id uuid;
BEGIN
  IF COALESCE(NEW.is_deleted, false)
     OR starts_with(COALESCE(NEW.period_label, ''), '__QA__') THEN
    RETURN NEW;
  END IF;

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

    BEGIN
      PERFORM public.notify_assessment_run_share(NEW);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_assessment_run_share(%) failed: %', NEW.id, SQLERRM;
    END;

    BEGIN
      PERFORM public.promote_run_to_global_risk_library(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'promote_run_to_global_risk_library(%) failed: %', NEW.id, SQLERRM;
    END;

    IF to_regprocedure('public.ensure_high_risk_item_followup(uuid)') IS NOT NULL THEN
      FOR _item_id IN
        SELECT ri.id
          FROM public.risk_items ri
         WHERE ri.run_id = NEW.id
           AND COALESCE(ri.is_deleted, false) = false
           AND COALESCE(ri.is_excluded, false) = false
           AND public.is_focus_high_risk_item(ri.risk_grade, ri.improved_risk_grade)
      LOOP
        BEGIN
          PERFORM public.ensure_high_risk_item_followup(_item_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'ensure_high_risk_item_followup(%) failed: %', _item_id, SQLERRM;
        END;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;