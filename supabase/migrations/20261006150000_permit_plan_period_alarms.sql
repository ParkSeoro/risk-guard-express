-- Issued permits: one author notice after the effective end time.
-- Approved extension uses extension_until (written only when extend_sm approves).
-- Otherwise work_end_at, then form work_end. Pending extension requests do not move the end.
-- Approved work plans: one author notice on the KST day before end_date. No backfill.

ALTER TABLE public.work_plans
  ADD COLUMN IF NOT EXISTS end_warning_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.permit_effective_end_at(
  _extension_until timestamptz,
  _work_end_at timestamptz,
  _form_work_end text
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw text;
BEGIN
  IF _extension_until IS NOT NULL THEN
    RETURN _extension_until;
  END IF;
  IF _work_end_at IS NOT NULL THEN
    RETURN _work_end_at;
  END IF;
  raw := NULLIF(btrim(COALESCE(_form_work_end, '')), '');
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN raw::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_permit_expiries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p record;
  _n integer := 0;
  _end timestamptz;
  _link text;
BEGIN
  FOR _p IN
    SELECT id, project_id, work_description, created_by,
           extension_until, work_end_at, form_data
      FROM public.work_permits
     WHERE COALESCE(is_deleted, false) = false
       AND expiry_notified_at IS NULL
       AND COALESCE(status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
  LOOP
    _end := public.permit_effective_end_at(
      _p.extension_until,
      _p.work_end_at,
      _p.form_data->>'work_end'
    );
    IF _end IS NULL OR _end > now() THEN
      CONTINUE;
    END IF;
    -- First deploy must not replay every historical issued permit.
    IF _end < now() - interval '36 hours' THEN
      UPDATE public.work_permits SET expiry_notified_at = now() WHERE id = _p.id;
      CONTINUE;
    END IF;

    _link := '/work-permits/' || _p.id::text;
    IF _p.created_by IS NOT NULL THEN
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES (
        _p.created_by,
        _p.project_id,
        'permit_expiry',
        '작업시간 종료',
        '작업시간이 끝났습니다. 작업종료를 하세요',
        '작업시간이 끝났습니다. 작업종료를 하세요',
        'work_permit',
        _p.id::text,
        _link,
        false
      );
      _n := _n + 1;
    END IF;
    UPDATE public.work_permits SET expiry_notified_at = now() WHERE id = _p.id;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_permit_expiries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_permit_expiries() TO service_role;

CREATE OR REPLACE FUNCTION public.scan_work_plan_end_warnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p record;
  _n integer := 0;
  _kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  _author uuid;
  _link text;
BEGIN
  FOR _p IN
    SELECT id, project_id, title, end_date, author_user_id, created_by
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
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES (
        _author,
        _p.project_id,
        'work_plan_due',
        '작업계획서 종료 하루 전',
        '종료 하루 전입니다. 갱신하거나 새로 작성하세요',
        '종료 하루 전입니다. 갱신하거나 새로 작성하세요',
        'work_plan',
        _p.id::text,
        _link,
        false
      );
      _n := _n + 1;
    END IF;
    UPDATE public.work_plans SET end_warning_notified_at = now() WHERE id = _p.id;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_work_plan_end_warnings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_work_plan_end_warnings() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('scan-permit-expiries')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-permit-expiries');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'scan-permit-expiries',
  '*/10 * * * *',
  $$SELECT public.scan_permit_expiries();$$
);

DO $$
BEGIN
  PERFORM cron.unschedule('scan-work-plan-end-warnings')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-work-plan-end-warnings');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 00:10 KST. The function itself uses Asia/Seoul, so a UTC calendar date is not the due date.
SELECT cron.schedule(
  'scan-work-plan-end-warnings',
  '10 15 * * *',
  $$SELECT public.scan_work_plan_end_warnings();$$
);
