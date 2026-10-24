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

SELECT public.hide_system_test_documents_apply(NULL::uuid);