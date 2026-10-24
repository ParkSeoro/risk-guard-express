-- Live definition captured 2026-10-24 before the lock-skip change. Restore with this statement only.
-- Does not reschedule cron.

CREATE OR REPLACE FUNCTION public.scan_work_plan_end_warnings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p record; _n integer := 0; _kst date := (now() AT TIME ZONE 'Asia/Seoul')::date; _author uuid; _link text;
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
    UPDATE public.work_plans SET end_warning_notified_at = now() WHERE id = _p.id;
  END LOOP;
  RETURN _n;
END; $function$
