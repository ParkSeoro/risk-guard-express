-- Morning notice for people named on an approved permit who have no entry that day.
-- Does not write attendance, absence, or payroll. 10:00 KST (01:00 UTC).
-- Pre-registered workers stay off the permit list unless they are on that permit.
-- Future hire dates stay off the general no-entry roster.

CREATE OR REPLACE FUNCTION public.list_attendance_exceptions(_project_id uuid, _date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_day date := COALESCE(_date, (timezone('Asia/Seoul', now()))::date);
  v_start timestamptz := (v_day::timestamp AT TIME ZONE 'Asia/Seoul');
  v_end timestamptz := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul') - interval '1 millisecond';
  v_has_tbm boolean;
BEGIN
  v_uid := public.labor_assert_project_read(_project_id);
  SELECT EXISTS (SELECT 1 FROM public.tbm_sessions s WHERE s.project_id = _project_id AND s.tbm_date = v_day AND COALESCE(s.is_deleted, false) = false) INTO v_has_tbm;
  RETURN jsonb_build_object(
    'date', v_day,
    'missing_attendance', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name, 'job_type', w.job_type) ORDER BY w.company_name, w.name)
      FROM public.workers w WHERE w.project_id = _project_id AND COALESCE(w.is_active, true)
        AND (w.hire_date IS NULL OR w.hire_date <= v_day)
        AND (w.site_entry_suspended_until IS NULL OR w.site_entry_suspended_until <= now())
        AND NOT EXISTS (SELECT 1 FROM public.worker_entry_logs e WHERE e.worker_id = w.id AND e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end)
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb),
    'missing_exit', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name, 'entry_log_id', e.id, 'entry_at', e.entry_at, 'work_date', (e.entry_at AT TIME ZONE 'Asia/Seoul')::date) ORDER BY e.entry_at)
      FROM public.worker_entry_logs e JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id AND e.exit_at IS NULL AND e.entry_at < v_end
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb),
    'missing_daily_ack', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name, 'entry_at', e.entry_at) ORDER BY w.name)
      FROM public.worker_entry_logs e JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end
        AND NOT EXISTS (SELECT 1 FROM public.worker_daily_acks a WHERE a.project_id = _project_id AND a.worker_id = e.worker_id AND a.ack_date = v_day)
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb),
    'missing_tbm', CASE WHEN NOT v_has_tbm THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name) ORDER BY w.name)
      FROM public.worker_entry_logs e JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end AND COALESCE(e.tbm_confirmed, false) = false
        AND NOT EXISTS (SELECT 1 FROM public.tbm_participations p JOIN public.tbm_sessions s ON s.id = p.tbm_session_id
          WHERE s.project_id = _project_id AND s.tbm_date = v_day AND COALESCE(s.is_deleted, false) = false AND COALESCE(p.briefing_confirmed, true)
            AND (p.worker_id = e.worker_id OR regexp_replace(COALESCE(p.worker_phone, ''), '\D', '', 'g') = regexp_replace(COALESCE(w.phone, ''), '\D', '', 'g')))
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb) END,
    'duplicate_entry', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', d.worker_id, 'worker_name', w.name, 'company_name', w.company_name, 'count', d.cnt) ORDER BY w.name)
      FROM (SELECT e.worker_id, COUNT(*)::int AS cnt FROM public.worker_entry_logs e WHERE e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end GROUP BY e.worker_id HAVING COUNT(*) > 1) d
      JOIN public.workers w ON w.id = d.worker_id
      WHERE public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id)), '[]'::jsonb),
    'overdue_required', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name, 'item_type', r.item_type, 'subtype', r.subtype, 'due_date', r.due_date, 'status', r.status) ORDER BY r.due_date)
      FROM public.worker_required_items r JOIN public.workers w ON w.id = r.worker_id
      WHERE r.project_id = _project_id AND COALESCE(r.is_deleted, false) = false AND r.status IN ('overdue', 'due') AND (r.due_date IS NULL OR r.due_date <= v_day) AND r.status <> 'done'
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb),
    'missing_health_log', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name) ORDER BY w.name)
      FROM public.workers w WHERE w.project_id = _project_id AND COALESCE(w.is_active, true) AND COALESCE(w.requires_daily_health_log, false)
        AND EXISTS (SELECT 1 FROM public.worker_entry_logs e WHERE e.worker_id = w.id AND e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end)
        AND NOT EXISTS (SELECT 1 FROM public.worker_daily_health_logs h WHERE h.worker_id = w.id AND h.log_date = v_day AND COALESCE(h.is_deleted, false) = false)
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb),
    'gps_blocked', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', st.worker_id, 'worker_name', w.name, 'company_name', w.company_name, 'block_reason', st.block_reason, 'updated_at', st.updated_at) ORDER BY st.updated_at DESC)
      FROM public.worker_gps_status st JOIN public.workers w ON w.id = st.worker_id
      WHERE st.project_id = _project_id AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb),
    'permit_crew_total', (
      SELECT COUNT(DISTINCT pw.worker_id)::int
        FROM public.work_permit_workers pw
        JOIN public.work_permits p ON p.id = pw.work_permit_id
        JOIN public.workers w ON w.id = pw.worker_id
       WHERE pw.project_id = _project_id
         AND p.permit_date = v_day
         AND COALESCE(p.is_deleted, false) = false
         AND COALESCE(p.status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
         AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ),
    'permit_no_show', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name, 'work_permit_id', pw.work_permit_id, 'work_name', COALESCE(p.work_name, '')) ORDER BY w.name)
      FROM public.work_permit_workers pw JOIN public.work_permits p ON p.id = pw.work_permit_id JOIN public.workers w ON w.id = pw.worker_id
      WHERE pw.project_id = _project_id AND p.permit_date = v_day AND COALESCE(p.is_deleted, false) = false
        AND COALESCE(p.status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
        AND NOT EXISTS (SELECT 1 FROM public.worker_entry_logs e WHERE e.worker_id = pw.worker_id AND e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end)
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb),
    'ppe_pending', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', e.worker_id, 'worker_name', e.worker_name, 'item_name', e.item_name, 'issued_at', e.issued_at) ORDER BY e.issued_at DESC)
      FROM public.safety_cost_ppe_ledger_entries e LEFT JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id AND COALESCE(e.is_deleted, false) = false AND e.receipt_status = 'pending'
        AND EXISTS (SELECT 1 FROM public.worker_entry_logs lg WHERE lg.project_id = _project_id AND lg.entry_at BETWEEN v_start AND v_end AND lg.worker_id = e.worker_id)
        AND (public.is_master(v_uid) OR w.id IS NULL OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb)
  );
END;$function$;

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
  r record;
  proj record;
  v_sent integer := 0;
  v_rows integer := 0;
  v_name text;
  v_message text;
BEGIN
  FOR r IN
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
     ORDER BY w.id, pr.user_id, p.work_name
  LOOP
    IF EXISTS (
      SELECT 1
        FROM public.notifications n
       WHERE n.user_id = r.user_id
         AND n.type = 'permit_crew_no_show'
         AND n.project_id = r.project_id
         AND n.related_id = r.worker_id::text
         AND (n.created_at AT TIME ZONE 'Asia/Seoul')::date = v_day
    ) THEN
      CONTINUE;
    END IF;

    v_name := COALESCE(NULLIF(btrim(r.work_name), ''), '작업허가서');
    v_message := r.worker_name || '님, 오늘 허가서(' || v_name || ') 예정 인원인데 출근 처리가 없습니다. 현장에 계시면 출근을 눌러 주세요.';
    INSERT INTO public.notifications (
      user_id, project_id, type, title, message, body, related_type, related_id, link, is_read
    ) VALUES (
      r.user_id,
      r.project_id,
      'permit_crew_no_show',
      '오늘 출근 처리가 없습니다',
      v_message,
      v_message,
      'worker',
      r.worker_id::text,
      '/app/worker/today',
      false
    );
    v_sent := v_sent + 1;
  END LOOP;

  FOR proj IN
    SELECT x.project_id,
           COUNT(DISTINCT x.worker_id)::int AS crew_total,
           COUNT(DISTINCT x.worker_id) FILTER (WHERE NOT x.present)::int AS missing
      FROM (
        SELECT pw.project_id,
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
         WHERE COALESCE(permit.is_deleted, false) = false
           AND permit.permit_date = v_day
           AND COALESCE(permit.status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
      ) x
     GROUP BY x.project_id
    HAVING COUNT(DISTINCT x.worker_id) FILTER (WHERE NOT x.present) > 0
  LOOP
    v_message := '오늘 허가서 예정 ' || proj.crew_total || '명 중 ' || proj.missing || '명이 출근 처리되지 않았습니다.';
    INSERT INTO public.notifications (
      user_id, project_id, type, title, message, body, related_type, link, is_read
    )
    SELECT DISTINCT pm.user_id,
           proj.project_id,
           'permit_crew_no_show_summary',
           '허가서 예정 인원 출근 미처리',
           v_message,
           v_message,
           'work_permit',
           '/app/admin/workers',
           false
      FROM public.project_members pm
     WHERE pm.project_id = proj.project_id
       AND pm.user_id IS NOT NULL
       AND lower(COALESCE(pm.role_new::text, '')) IN ('project_admin', 'safety_manager', 'site_manager')
       AND NOT EXISTS (
         SELECT 1
           FROM public.notifications n
          WHERE n.user_id = pm.user_id
            AND n.project_id = proj.project_id
            AND n.type = 'permit_crew_no_show_summary'
            AND (n.created_at AT TIME ZONE 'Asia/Seoul')::date = v_day
       );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_sent := v_sent + v_rows;
  END LOOP;

  RETURN v_sent;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_permit_crew_no_shows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_permit_crew_no_shows() TO service_role;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'notify-permit-crew-no-shows';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'notify-permit-crew-no-shows',
  '0 1 * * *',
  $$SELECT public.notify_permit_crew_no_shows();$$
);
