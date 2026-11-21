-- Daily 1x (07:00 KST) overnight-job Telegram briefing RPC + pg_cron trigger.
-- Replaces the legacy 2x/day GitHub Actions generic status alert with a concise
-- summary of all overnight batch jobs (Google One backup, consistency audit,
-- work-plan expiry scan, stale worker location purge, and critical anomalies).

CREATE OR REPLACE FUNCTION public.get_nightly_ops_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_now_kst timestamp := now() AT TIME ZONE 'Asia/Seoul';
  v_kst_day_start timestamptz := date_trunc('day', v_now_kst) AT TIME ZONE 'Asia/Seoul';
  v_backup jsonb;
  v_archive jsonb;
  v_cron_jobs jsonb;
  v_consistency jsonb;
BEGIN
  -- 1. Today's overnight Google One backup ticks (since 00:00 KST)
  SELECT jsonb_build_object(
    'ticks', COALESCE(COUNT(*), 0),
    'copied', COALESCE(SUM(copied_cnt), 0),
    'verified', COALESCE(SUM(verified_cnt), 0),
    'purged', COALESCE(SUM(purged_cnt), 0),
    'skipped', COALESCE(SUM(skipped_cnt), 0),
    'errors', COALESCE(SUM(error_cnt), 0),
    'circuit_broken', COALESCE(BOOL_OR(circuit_broken), false),
    'mode', MAX(mode),
    'quota_used_bytes', MAX(quota_used_bytes),
    'quota_limit_bytes', MAX(quota_limit_bytes),
    'last_finished_kst', to_char(MAX(finished_at) AT TIME ZONE 'Asia/Seoul', 'HH24:MI'),
    'notes', COALESCE(
      (
        SELECT jsonb_agg(n)
        FROM (
          SELECT DISTINCT notes AS n
          FROM public.storage_backup_runs
          WHERE started_at >= v_kst_day_start
            AND notes IS NOT NULL
            AND btrim(notes) <> ''
          LIMIT 5
        ) t
      ),
      '[]'::jsonb
    )
  )
  INTO v_backup
  FROM public.storage_backup_runs
  WHERE started_at >= v_kst_day_start;

  -- 2. Cumulative Google One archive totals
  SELECT jsonb_build_object(
    'total_backed_up', COUNT(*) FILTER (WHERE archive_status IN ('backed_up', 'verified', 'purged')),
    'total_purged', COUNT(*) FILTER (WHERE archive_status = 'purged'),
    'total_bytes', COALESCE(SUM(file_size) FILTER (WHERE archive_status IN ('backed_up', 'verified', 'purged')), 0),
    'failed_count', COUNT(*) FILTER (WHERE archive_status = 'failed' OR last_error IS NOT NULL)
  )
  INTO v_archive
  FROM public.storage_archive_registry;

  -- 3. Overnight pg_cron jobs executed between 00:00 KST and 07:00 KST (plus any failed job today)
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY first_start_kst), '[]'::jsonb)
  INTO v_cron_jobs
  FROM (
    SELECT
      MIN(d.start_time AT TIME ZONE 'Asia/Seoul') AS first_start_kst,
      jsonb_build_object(
        'jobname', j.jobname,
        'runs', COUNT(*),
        'succeeded', COUNT(*) FILTER (WHERE d.status = 'succeeded'),
        'failed', COUNT(*) FILTER (WHERE d.status <> 'succeeded'),
        'last_status', (ARRAY_AGG(d.status ORDER BY d.start_time DESC))[1],
        'last_start_kst', to_char(MAX(d.start_time) AT TIME ZONE 'Asia/Seoul', 'HH24:MI'),
        'last_error', (ARRAY_AGG(d.return_message ORDER BY d.start_time DESC) FILTER (WHERE d.status <> 'succeeded'))[1]
      ) AS row_obj
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
    WHERE d.start_time >= v_kst_day_start
      AND j.jobname <> 'safenex-nightly-telegram-report'
      AND (
        EXTRACT(HOUR FROM (d.start_time AT TIME ZONE 'Asia/Seoul')) < 7
        OR d.status <> 'succeeded'
      )
    GROUP BY j.jobname
  ) sub;

  -- 4. Consistency audit summary (safe fallback on error)
  BEGIN
    v_consistency := public.audit_data_consistency();
  EXCEPTION WHEN OTHERS THEN
    v_consistency := jsonb_build_object('error', SQLERRM, 'total_issues', -1);
  END;

  RETURN jsonb_build_object(
    'report_date_kst', to_char(v_now_kst, 'YYYY-MM-DD'),
    'generated_at_kst', to_char(v_now_kst, 'YYYY-MM-DD HH24:MI:SS'),
    'backup', v_backup,
    'archive', v_archive,
    'cron_jobs', v_cron_jobs,
    'consistency_issues', COALESCE((v_consistency->>'total_issues')::int, 0),
    'consistency_error', v_consistency->>'error'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_nightly_ops_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_nightly_ops_report() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_nightly_ops_report() TO service_role;

CREATE OR REPLACE FUNCTION public.trigger_nightly_telegram_report()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _secret text;
BEGIN
  _secret := public.get_runtime_secret('BACKUP_TRIGGER_SECRET');
  IF _secret IS NULL OR _secret = '' THEN
    RAISE WARNING 'BACKUP_TRIGGER_SECRET not configured; skipping nightly telegram report';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qhntxmggacorqjjmjqgo.supabase.co/functions/v1/send-nightly-telegram-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-backup-trigger-secret', _secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_nightly_telegram_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_nightly_telegram_report() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_nightly_telegram_report() TO service_role;

-- Schedule once daily at 07:00 KST (22:00 UTC)
DO $$
DECLARE
  _existing_id bigint;
BEGIN
  SELECT jobid INTO _existing_id FROM cron.job WHERE jobname = 'safenex-nightly-telegram-report';
  IF _existing_id IS NOT NULL THEN
    PERFORM cron.unschedule(_existing_id);
  END IF;
END $$;

SELECT cron.schedule(
  'safenex-nightly-telegram-report',
  '0 22 * * *',
  $$SELECT public.trigger_nightly_telegram_report();$$
);
