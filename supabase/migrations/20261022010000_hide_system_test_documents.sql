-- System-test rows are tagged __QA__. They are real inserts on the live project,
-- and approved ones cannot be soft-deleted from the app because of the document lock.
-- Hide them on insert, and sweep any that are already visible.

CREATE OR REPLACE FUNCTION public.hide_system_test_documents_apply(_run_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_runs integer := 0;
  v_plans integer := 0;
  v_permits integer := 0;
  v_tbms integer := 0;
  v_items integer := 0;
  v_notes integer := 0;
BEGIN
  PERFORM set_config('app.skip_document_edit_lock', '1', true);
  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);

  UPDATE public.assessment_runs
     SET is_deleted = true,
         deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = COALESCE(NULLIF(btrim(deleted_reason), ''), '시스템 테스트 문서'),
         deleted_by = COALESCE(deleted_by, auth.uid())
   WHERE COALESCE(is_deleted, false) = false
     AND (
       starts_with(COALESCE(period_label, ''), '__QA__')
       OR (
         _run_id IS NOT NULL
         AND id IN (
           SELECT ref_id FROM public.system_test_artifacts
            WHERE run_id = _run_id AND ref_table = 'assessment_runs'
         )
       )
     );
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  UPDATE public.work_plans
     SET is_deleted = true,
         deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = COALESCE(NULLIF(btrim(deleted_reason), ''), '시스템 테스트 문서'),
         deleted_by = COALESCE(deleted_by, auth.uid())
   WHERE COALESCE(is_deleted, false) = false
     AND (
       starts_with(COALESCE(title, ''), '__QA__')
       OR (
         _run_id IS NOT NULL
         AND id IN (
           SELECT ref_id FROM public.system_test_artifacts
            WHERE run_id = _run_id AND ref_table = 'work_plans'
         )
       )
     );
  GET DIAGNOSTICS v_plans = ROW_COUNT;

  UPDATE public.work_permits
     SET is_deleted = true,
         deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = COALESCE(NULLIF(btrim(deleted_reason), ''), '시스템 테스트 문서'),
         deleted_by = COALESCE(deleted_by, auth.uid())
   WHERE COALESCE(is_deleted, false) = false
     AND (
       starts_with(COALESCE(work_name, ''), '__QA__')
       OR starts_with(COALESCE(work_description, ''), '__QA__')
       OR (
         _run_id IS NOT NULL
         AND id IN (
           SELECT ref_id FROM public.system_test_artifacts
            WHERE run_id = _run_id AND ref_table = 'work_permits'
         )
       )
     );
  GET DIAGNOSTICS v_permits = ROW_COUNT;

  UPDATE public.tbm_sessions
     SET is_deleted = true,
         deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = COALESCE(NULLIF(btrim(deleted_reason), ''), '시스템 테스트 문서'),
         deleted_by = COALESCE(deleted_by, auth.uid())
   WHERE COALESCE(is_deleted, false) = false
     AND (
       starts_with(COALESCE(title, ''), '__QA__')
       OR (
         _run_id IS NOT NULL
         AND id IN (
           SELECT ref_id FROM public.system_test_artifacts
            WHERE run_id = _run_id AND ref_table = 'tbm_sessions'
         )
       )
     );
  GET DIAGNOSTICS v_tbms = ROW_COUNT;

  UPDATE public.risk_items
     SET is_deleted = true,
         deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = COALESCE(NULLIF(btrim(deleted_reason), ''), '시스템 테스트 문서'),
         deleted_by = COALESCE(deleted_by, auth.uid())
   WHERE COALESCE(is_deleted, false) = false
     AND (
       starts_with(COALESCE(process, ''), '__QA__')
       OR run_id IN (
         SELECT id FROM public.assessment_runs
          WHERE starts_with(COALESCE(period_label, ''), '__QA__')
       )
       OR (
         _run_id IS NOT NULL
         AND id IN (
           SELECT ref_id FROM public.system_test_artifacts
            WHERE run_id = _run_id AND ref_table = 'risk_items'
         )
       )
     );
  GET DIAGNOSTICS v_items = ROW_COUNT;

  DELETE FROM public.notifications
   WHERE strpos(COALESCE(title, ''), '__QA__') > 0
      OR strpos(COALESCE(body, ''), '__QA__') > 0;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  -- Test share signatures are not part of a real run. Drop only those,
  -- so they do not show on the signature ledger. Real runs are untouched.
  DELETE FROM public.assessment_run_share_acks a
   USING public.assessment_runs r
   WHERE a.run_id = r.id
     AND starts_with(COALESCE(r.period_label, ''), '__QA__');

  RETURN jsonb_build_object(
    'success', true,
    'assessment_runs', v_runs,
    'work_plans', v_plans,
    'work_permits', v_permits,
    'tbm_sessions', v_tbms,
    'risk_items', v_items,
    'notifications', v_notes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.hide_system_test_documents_apply(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.hide_system_test_documents(_run_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  RETURN public.hide_system_test_documents_apply(_run_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.hide_system_test_documents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hide_system_test_documents(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.hide_system_test_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  marker text;
BEGIN
  marker := CASE TG_TABLE_NAME
    WHEN 'assessment_runs' THEN NEW.period_label
    WHEN 'work_plans' THEN NEW.title
    WHEN 'work_permits' THEN COALESCE(NULLIF(NEW.work_name, ''), NEW.work_description)
    WHEN 'tbm_sessions' THEN NEW.title
    WHEN 'risk_items' THEN NEW.process
    ELSE NULL
  END;

  IF starts_with(COALESCE(marker, ''), '__QA__') THEN
    NEW.is_deleted := true;
    IF NEW.deleted_at IS NULL THEN
      NEW.deleted_at := now();
    END IF;
    IF NULLIF(btrim(COALESCE(NEW.deleted_reason, '')), '') IS NULL THEN
      NEW.deleted_reason := '시스템 테스트 문서';
    END IF;
    IF NEW.deleted_by IS NULL THEN
      NEW.deleted_by := auth.uid();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.assessment_runs;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.assessment_runs
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.work_plans;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.work_plans
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.work_permits;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.work_permits
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.tbm_sessions;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.tbm_sessions
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();

DROP TRIGGER IF EXISTS trg_hide_system_test_document ON public.risk_items;
CREATE TRIGGER trg_hide_system_test_document
  BEFORE INSERT ON public.risk_items
  FOR EACH ROW EXECUTE FUNCTION public.hide_system_test_document();

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

SELECT public.hide_system_test_documents_apply(NULL);
