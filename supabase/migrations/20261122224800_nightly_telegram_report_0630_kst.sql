-- Move daily Telegram ops report from 07:00 KST (22:00 UTC) to 06:30 KST (21:30 UTC).
-- pg_cron's cron.schedule(job_name, schedule, command) updates the existing named job in place.

SELECT cron.schedule(
  'safenex-nightly-telegram-report',
  '30 21 * * *',
  $$SELECT public.trigger_nightly_telegram_report();$$
);
