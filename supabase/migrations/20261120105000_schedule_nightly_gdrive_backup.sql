-- Schedule nightly Google One backup ticks (KST 02:05 ~ 03:55 = UTC 17:05 ~ 18:55, every 10 min)
-- Strictly backup_only (purge_enabled = false) per PR #684 Clause 7 until full backlog & restore verified.
-- Offset by +5 min from :00/:30 so it never overlaps daily-consistency-audit or purge-worker-last-positions.

CREATE OR REPLACE FUNCTION public.trigger_nightly_gdrive_backup()
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
    RAISE WARNING 'BACKUP_TRIGGER_SECRET not configured; skipping nightly gdrive backup tick';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qhntxmggacorqjjmjqgo.supabase.co/functions/v1/backup-storage-to-gdrive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-backup-trigger-secret', _secret
    ),
    body := jsonb_build_object(
      'purge_enabled', false,
      'copy_min_age_days', 30,
      'max_files', 15,
      'max_bytes', 52428800
    ),
    timeout_milliseconds := 55000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_nightly_gdrive_backup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_nightly_gdrive_backup() FROM anon, authenticated;

DO $$
DECLARE
  _existing_id bigint;
BEGIN
  SELECT jobid INTO _existing_id FROM cron.job WHERE jobname = 'safenex-nightly-gdrive-backup';
  IF _existing_id IS NOT NULL THEN
    PERFORM cron.unschedule(_existing_id);
  END IF;
  PERFORM cron.schedule(
    'safenex-nightly-gdrive-backup',
    '5,15,25,35,45,55 17,18 * * *',
    'SELECT public.trigger_nightly_gdrive_backup();'
  );
END $$;
