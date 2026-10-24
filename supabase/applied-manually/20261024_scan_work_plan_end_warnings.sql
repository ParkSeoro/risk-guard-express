-- Applied by hand on 2026-10-24. Do not put this in supabase/migrations and do not db push it
-- until the three unapplied history files are neutralized. Replaying 20261006150000 would
-- move the cron to 10 15; the live job stays 0 15 * * * (00:00 KST).
-- Body is the live pg_get_functiondef plus a transaction-local lock skip around the stamp only.
-- Rollback: supabase/applied-manually/20261024_scan_work_plan_end_warnings_rollback.sql

CREATE OR REPLACE FUNCTION public.scan_work_plan_end_warnings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p record;
  _n integer := 0;
  _kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  _author uuid;
  _link text;
  _lock text;
BEGIN
  FOR _p IN
    SELECT id, project_id, author_user_id, created_by
      FROM public.work_plans
     WHERE COALESCE(is_deleted, false) = false
       AND end_warning_notified_at IS NULL
       AND end_date IS NOT NULL
       AND end_date::date = _kst + 1
       AND COALESCE(status, '') IN ('승인완료', '승인')
  LOOP
    _author := COALESCE(_p.author_user_id, _p.created_by);
    _link := '/work-plan/' || _p.id::text;
    IF _author IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES (_author, _p.project_id, 'work_plan_due', '작업계획서 종료 하루 전', '종료 하루 전입니다. 갱신하거나 새로 작성하세요', '종료 하루 전입니다. 갱신하거나 새로 작성하세요', 'work_plan', _p.id::text, _link, false);
      _n := _n + 1;
    END IF;
    _lock := current_setting('app.skip_document_edit_lock', true);
    PERFORM set_config('app.skip_document_edit_lock', '1', true);
    UPDATE public.work_plans SET end_warning_notified_at = now() WHERE id = _p.id;
    PERFORM set_config('app.skip_document_edit_lock', COALESCE(_lock, ''), true);
  END LOOP;
  RETURN _n;
END; $function$
