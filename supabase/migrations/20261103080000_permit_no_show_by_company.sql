-- One notice per company, only to managers who can already see that company.
-- Client managers receive every company. A GC receives its own company and
-- descendants. A contractor receives its own company. Projects stay separate.
-- Worker notices stay personal. No attendance, absence, or payroll writes.
-- Cron stays 10:00 KST. One INSERT per project (workers) and per company
-- (managers), so the push trigger makes one HTTP per statement.

CREATE OR REPLACE FUNCTION public.notify_permit_crew_no_shows()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_day date := (timezone('Asia/Seoul', now()))::date;
  v_start timestamptz := (v_day::timestamp AT TIME ZONE 'Asia/Seoul');
  v_end timestamptz := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul') - interval '1 millisecond';
  proj record;
  comp record;
  v_sent integer := 0;
  v_rows integer := 0;
  v_company text;
  v_message text;
BEGIN
  FOR proj IN
    SELECT DISTINCT w.project_id
      FROM public.work_permit_workers pw
      JOIN public.work_permits p ON p.id = pw.work_permit_id
      JOIN public.workers w ON w.id = pw.worker_id
      JOIN public.profiles pr
        ON public.normalize_phone_digits(pr.phone) = public.normalize_phone_digits(w.phone)
       AND public.normalize_phone_digits(w.phone) <> ''
     WHERE COALESCE(p.is_deleted, false) = false
       AND p.permit_date = v_day
       AND COALESCE(p.status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
       AND NOT EXISTS (
         SELECT 1
           FROM public.worker_entry_logs e
          WHERE e.worker_id = w.id
            AND e.project_id = w.project_id
            AND e.entry_at BETWEEN v_start AND v_end
       )
  LOOP
    INSERT INTO public.notifications (
      user_id, project_id, type, title, message, body, related_type, related_id, link, is_read
    )
    SELECT r.user_id,
           r.project_id,
           'permit_crew_no_show',
           '오늘 출근 처리가 없습니다',
           r.worker_name || '님, 오늘 허가서(' || COALESCE(NULLIF(btrim(r.work_name), ''), '작업허가서') || ') 예정 인원인데 출근 처리가 없습니다. 현장에 계시면 출근을 눌러 주세요.',
           r.worker_name || '님, 오늘 허가서(' || COALESCE(NULLIF(btrim(r.work_name), ''), '작업허가서') || ') 예정 인원인데 출근 처리가 없습니다. 현장에 계시면 출근을 눌러 주세요.',
           'worker',
           r.worker_id::text,
           '/app/worker/today',
           false
      FROM (
        SELECT DISTINCT ON (w.id, pr.user_id)
               w.id AS worker_id,
               w.project_id,
               w.name AS worker_name,
               pr.user_id,
               p.work_name
          FROM public.work_permit_workers pw
          JOIN public.work_permits p ON p.id = pw.work_permit_id
          JOIN public.workers w ON w.id = pw.worker_id
          JOIN public.profiles pr
            ON public.normalize_phone_digits(pr.phone) = public.normalize_phone_digits(w.phone)
           AND public.normalize_phone_digits(w.phone) <> ''
         WHERE w.project_id = proj.project_id
           AND COALESCE(p.is_deleted, false) = false
           AND p.permit_date = v_day
           AND COALESCE(p.status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
           AND NOT EXISTS (
             SELECT 1
               FROM public.worker_entry_logs e
              WHERE e.worker_id = w.id
                AND e.project_id = w.project_id
                AND e.entry_at BETWEEN v_start AND v_end
           )
         ORDER BY w.id, pr.user_id, p.work_name
      ) r
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.notifications n
        WHERE n.user_id = r.user_id
          AND n.type = 'permit_crew_no_show'
          AND n.project_id = r.project_id
          AND n.related_id = r.worker_id::text
          AND (n.created_at AT TIME ZONE 'Asia/Seoul')::date = v_day
     );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_sent := v_sent + v_rows;
  END LOOP;

  FOR comp IN
    SELECT x.project_id,
           x.company_id,
           COUNT(DISTINCT x.worker_id)::int AS crew_total,
           COUNT(DISTINCT x.worker_id) FILTER (WHERE NOT x.present)::int AS missing
      FROM (
        SELECT pw.project_id,
               w.company_id,
               pw.worker_id,
               EXISTS (
                 SELECT 1
                   FROM public.worker_entry_logs e
                  WHERE e.worker_id = pw.worker_id
                    AND e.project_id = pw.project_id
                    AND e.entry_at BETWEEN v_start AND v_end
               ) AS present
          FROM public.work_permit_workers pw
          JOIN public.work_permits permit ON permit.id = pw.work_permit_id
          JOIN public.workers w ON w.id = pw.worker_id
         WHERE COALESCE(permit.is_deleted, false) = false
           AND permit.permit_date = v_day
           AND COALESCE(permit.status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
      ) x
     GROUP BY x.project_id, x.company_id
    HAVING COUNT(DISTINCT x.worker_id) FILTER (WHERE NOT x.present) > 0
  LOOP
    v_company := NULL;
    SELECT NULLIF(btrim(c.name), '') INTO v_company
      FROM public.companies c
     WHERE c.id = comp.company_id;
    v_message := COALESCE(v_company || ' ', '오늘 ')
      || '허가서 예정 ' || comp.crew_total || '명 중 ' || comp.missing || '명이 출근 처리되지 않았습니다.';
    INSERT INTO public.notifications (
      user_id, project_id, type, title, message, body, related_type, related_id, link, is_read
    )
    SELECT DISTINCT ON (pm.user_id)
           pm.user_id,
           comp.project_id,
           'permit_crew_no_show_summary',
           '허가서 예정 인원 출근 미처리',
           v_message,
           v_message,
           'work_permit',
           comp.company_id::text,
           '/app/admin/workers',
           false
      FROM public.project_members pm
     WHERE pm.project_id = comp.project_id
       AND pm.user_id IS NOT NULL
       AND lower(COALESCE(pm.role_new::text, '')) IN ('project_admin', 'safety_manager', 'site_manager')
       AND public.can_access_company_data(pm.user_id, comp.project_id, comp.company_id)
       AND NOT EXISTS (
         SELECT 1
           FROM public.notifications n
          WHERE n.user_id = pm.user_id
            AND n.project_id = comp.project_id
            AND n.type = 'permit_crew_no_show_summary'
            AND (n.created_at AT TIME ZONE 'Asia/Seoul')::date = v_day
            AND n.related_id IS NOT DISTINCT FROM comp.company_id::text
       )
     ORDER BY pm.user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_sent := v_sent + v_rows;
  END LOOP;

  RETURN v_sent;
END;
$$;
