-- Fix nightly data-consistency cron:
-- 1) audit_data_consistency() previously required is_master(auth.uid()), but cron
--    runs as service_role with auth.uid() = NULL → always failed.
-- 2) run_daily_consistency_audit() summed every numeric JSON field including
--    total_issues, double-counting (and mis-counting) for notifications.

CREATE OR REPLACE FUNCTION public.audit_data_consistency()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  legacy_dept_count int;
  legacy_assignee_count int;
  orphan_risk_dept int;
  duplicate_managers int;
  workers_no_company int;
BEGIN
  -- Interactive callers must be master; cron/service_role has NULL uid.
  IF auth.uid() IS NOT NULL AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Only master role can run consistency audit';
  END IF;

  SELECT count(*) INTO legacy_dept_count
  FROM public.master_departments md
  WHERE NOT EXISTS (SELECT 1 FROM public.company_departments cd WHERE lower(cd.name) = lower(md.name));

  SELECT count(*) INTO legacy_assignee_count
  FROM public.department_assignees da
  WHERE da.default_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.company_managers cm
      WHERE cm.user_id = da.default_user_id AND cm.is_deleted = FALSE
    );

  SELECT count(*) INTO orphan_risk_dept
  FROM public.risk_items ri
  WHERE ri.responsible_department_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.company_departments cd WHERE cd.id = ri.responsible_department_id)
    AND NOT EXISTS (SELECT 1 FROM public.master_departments md WHERE md.id = ri.responsible_department_id);

  SELECT count(*) INTO duplicate_managers
  FROM (
    SELECT company_id, user_id
    FROM public.company_managers
    WHERE user_id IS NOT NULL AND is_deleted = FALSE
    GROUP BY company_id, user_id
    HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO workers_no_company
  FROM public.workers
  WHERE company_id IS NULL AND COALESCE(is_active, true) = true;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'legacy_departments_not_migrated', legacy_dept_count,
    'legacy_assignees_not_migrated', legacy_assignee_count,
    'orphan_risk_item_department_refs', orphan_risk_dept,
    'duplicate_company_managers', duplicate_managers,
    'workers_without_company', workers_no_company,
    'total_issues', legacy_dept_count + legacy_assignee_count + orphan_risk_dept + duplicate_managers + workers_no_company
  );
END;
$function$;

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
  v_report := public.audit_data_consistency();
  v_issue_count := COALESCE((v_report->>'total_issues')::int, 0);

  IF v_issue_count = 0 THEN
    RETURN jsonb_build_object('ok', true, 'issues', 0, 'ran_at', now(), 'report', v_report);
  END IF;

  v_summary := format(
    '데이터 정합성 검사에서 %s건의 이슈가 감지되었습니다. /admin/data-audit 에서 확인하세요.',
    v_issue_count
  );

  FOR v_master IN
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'master'
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link, created_at)
    VALUES (v_master, '데이터 정합성 경고', v_summary, 'warning', '/admin/data-audit', now());
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'issues', v_issue_count,
    'notified_masters', true,
    'ran_at', now(),
    'report', v_report
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_daily_consistency_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_daily_consistency_audit() TO service_role;
REVOKE ALL ON FUNCTION public.audit_data_consistency() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_data_consistency() TO authenticated, service_role;
