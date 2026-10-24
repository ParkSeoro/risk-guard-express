-- Applied by hand on 2026-10-24. Do not put this in supabase/migrations.
-- Live function plus one assignment: a __QA__ TBM insert is also inactive.
-- Other tables are unchanged. is_active is not referenced for them.
-- The UPDATE touches only rows that are already deleted and titled __QA__.
-- Rollback: supabase/applied-manually/20261024_hide_qa_tbm_inactive_rollback.sql

CREATE OR REPLACE FUNCTION public.hide_system_test_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  rowj jsonb := to_jsonb(NEW);
  marker text;
BEGIN
  marker := CASE TG_TABLE_NAME
    WHEN 'assessment_runs' THEN rowj->>'period_label'
    WHEN 'work_plans' THEN rowj->>'title'
    WHEN 'work_permits' THEN COALESCE(NULLIF(rowj->>'work_name', ''), rowj->>'work_description')
    WHEN 'tbm_sessions' THEN rowj->>'title'
    WHEN 'risk_items' THEN rowj->>'process'
    ELSE NULL
  END;

  IF starts_with(COALESCE(marker, ''), '__QA__') THEN
    NEW.is_deleted := true;
    IF TG_TABLE_NAME = 'tbm_sessions' THEN
      NEW.is_active := false;
    END IF;
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

UPDATE public.tbm_sessions
   SET is_active = false
 WHERE COALESCE(is_deleted, false)
   AND COALESCE(is_active, false)
   AND starts_with(COALESCE(title, ''), '__QA__');
