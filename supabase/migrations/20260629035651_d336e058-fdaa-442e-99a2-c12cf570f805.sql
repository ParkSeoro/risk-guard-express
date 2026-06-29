-- Daily data consistency audit → notify masters when issues found
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.run_daily_consistency_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report jsonb;
  v_issue_count int := 0;
  v_master uuid;
  v_summary text;
BEGIN
  -- Run audit (returns aggregated jsonb report)
  v_report := public.audit_data_consistency();

  -- Heuristic: count numeric "issues"/"count" fields in the report
  SELECT COALESCE(SUM(
    CASE
      WHEN jsonb_typeof(value) = 'number' THEN (value)::text::int
      ELSE 0
    END
  ), 0)
  INTO v_issue_count
  FROM jsonb_each(COALESCE(v_report->'counts', v_report));

  IF v_issue_count = 0 THEN
    RETURN jsonb_build_object('ok', true, 'issues', 0, 'ran_at', now());
  END IF;

  v_summary := format('데이터 정합성 검사에서 %s건의 이슈가 감지되었습니다. /admin/data-audit 에서 확인하세요.', v_issue_count);

  -- Notify every master
  FOR v_master IN
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'master'
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link, created_at)
    VALUES (v_master, '데이터 정합성 경고', v_summary, 'warning', '/admin/data-audit', now())
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'issues', v_issue_count, 'notified_masters', true, 'ran_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.run_daily_consistency_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_daily_consistency_audit() TO service_role;

-- Schedule daily at 17:00 UTC (= 02:00 KST)
DO $$
BEGIN
  PERFORM cron.unschedule('daily-consistency-audit')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-consistency-audit');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'daily-consistency-audit',
  '0 17 * * *',
  $$SELECT public.run_daily_consistency_audit();$$
);