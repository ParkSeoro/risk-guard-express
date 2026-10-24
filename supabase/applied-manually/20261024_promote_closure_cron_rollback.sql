-- Removes the two closure-promotion cron jobs. Does not change the function
-- or any permit. Does not call promote_permits_to_closure_pending.

SELECT cron.unschedule(jobid)
  FROM cron.job
 WHERE jobname IN ('promote-closure-0905-kst', 'promote-closure-1105-kst');
