-- PR 1-D: Fix GPS tracking health denominator and attendance exception gps_blocked query.
--
-- 1) get_gps_tracking_health:
--    - Denominator switches from "anyone with 12h status/position row" (which flooded
--      disconnected with 66% no_checkin non-attendees and already-exited workers while
--      missing checked-in workers with zero pings) to "today's KST open worker_entry_logs
--      (DISTINCT ON worker_id)".
--    - Filters out stale `no_checkin` block_reason for checked-in workers.
-- 2) list_attendance_exceptions:
--    - Fixes `gps_blocked` to require non-empty `block_reason`, exclude `no_checkin`,
--      restrict to the target KST day window, and require same-day check-in.

CREATE OR REPLACE FUNCTION public.get_gps_tracking_health(_project_id uuid)
RETURNS TABLE(
  worker_id uuid,
  worker_name text,
  company_id uuid,
  company_name text,
  last_fix_at timestamp with time zone,
  bucket text,
  block_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _role text;
  _is_master boolean;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  _is_master := public.is_master(_uid);

  SELECT pm.role_new::text
    INTO _role
    FROM public.project_members pm
   WHERE pm.project_id = _project_id
     AND pm.user_id = _uid
   ORDER BY CASE pm.role_new::text
     WHEN 'master' THEN 0
     WHEN 'project_admin' THEN 1
     WHEN 'safety_manager' THEN 2
     ELSE 10
   END
   LIMIT 1;

  IF NOT _is_master AND _role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH on_site AS (
    SELECT DISTINCT ON (e.worker_id)
      e.worker_id,
      e.entry_at
    FROM public.worker_entry_logs e
    WHERE e.project_id = _project_id
      AND e.exit_at IS NULL
      AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
    ORDER BY e.worker_id, e.entry_at DESC
  ),
  src AS (
    SELECT
      w.id AS worker_id,
      w.name AS worker_name,
      COALESCE(wlp.company_id, st.company_id, w.company_id) AS company_id,
      CASE
        WHEN wlp.updated_at IS NOT NULL
         AND wlp.updated_at >= o.entry_at - interval '10 minutes'
        THEN wlp.updated_at
        ELSE NULL
      END AS last_fix_at,
      CASE
        WHEN st.block_reason IS NOT NULL
         AND btrim(st.block_reason) <> ''
         AND st.block_reason <> 'no_checkin'
        THEN st.block_reason
        ELSE NULL
      END AS block_reason
    FROM on_site o
    JOIN public.workers w ON w.id = o.worker_id
    LEFT JOIN public.worker_last_positions wlp
      ON wlp.worker_id = w.id
     AND wlp.project_id = _project_id
    LEFT JOIN public.worker_gps_status st
      ON st.worker_id = w.id
     AND st.project_id = _project_id
    WHERE w.project_id = _project_id
      AND COALESCE(w.is_active, true) = true
  )
  SELECT
    s.worker_id,
    s.worker_name,
    s.company_id,
    COALESCE(c.name, '(미지정)') AS company_name,
    s.last_fix_at,
    CASE
      WHEN s.last_fix_at IS NOT NULL AND s.last_fix_at >= now() - interval '5 minutes' THEN 'live'
      WHEN s.last_fix_at IS NOT NULL AND s.last_fix_at >= now() - interval '30 minutes' THEN 'delayed'
      ELSE 'disconnected'
    END AS bucket,
    s.block_reason
  FROM src s
  LEFT JOIN public.companies c ON c.id = s.company_id
  WHERE
    _is_master
    OR public.can_access_company_data(_uid, _project_id, s.company_id)
  ORDER BY
    CASE
      WHEN s.last_fix_at IS NULL OR s.last_fix_at < now() - interval '30 minutes' THEN 0
      WHEN s.last_fix_at < now() - interval '5 minutes' THEN 1
      ELSE 2
    END,
    s.last_fix_at NULLS FIRST,
    s.worker_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_attendance_exceptions(_project_id uuid, _date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_day date := COALESCE(_date, (timezone('Asia/Seoul', now()))::date);
  v_start timestamptz := (v_day::timestamp AT TIME ZONE 'Asia/Seoul');
  v_end timestamptz := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul') - interval '1 millisecond';
  v_has_tbm boolean;
BEGIN
  v_uid := public.labor_assert_project_read(_project_id);
  SELECT EXISTS (
    SELECT 1 FROM public.tbm_sessions s
    WHERE s.project_id = _project_id
      AND s.tbm_date = v_day
      AND COALESCE(s.is_deleted, false) = false
  ) INTO v_has_tbm;

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
            AND (p.worker_id = e.worker_id OR regexp_replace(COALESCE(p.worker_phone, ''), '[^0-9]', '', 'g') = regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g')))
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
      WHERE st.project_id = _project_id
        AND st.block_reason IS NOT NULL
        AND btrim(st.block_reason) <> ''
        AND st.block_reason <> 'no_checkin'
        AND EXISTS (
          SELECT 1
            FROM public.worker_entry_logs e
           WHERE e.worker_id = st.worker_id
             AND e.project_id = _project_id
             AND e.entry_at BETWEEN v_start AND v_end
        )
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb),
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
        AND NOT public.permit_roster_always_present(w.id, v_day)
        AND NOT EXISTS (SELECT 1 FROM public.worker_entry_logs e WHERE e.worker_id = pw.worker_id AND e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end)
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb),
    'ppe_pending', COALESCE((SELECT jsonb_agg(jsonb_build_object('worker_id', e.worker_id, 'worker_name', e.worker_name, 'company_name', w.company_name, 'item_name', e.item_name, 'issued_at', e.issued_at) ORDER BY e.issued_at DESC)
      FROM public.safety_cost_ppe_ledger_entries e LEFT JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id AND COALESCE(e.is_deleted, false) = false AND e.receipt_status = 'pending'
        AND EXISTS (SELECT 1 FROM public.worker_entry_logs lg WHERE lg.project_id = _project_id AND lg.entry_at BETWEEN v_start AND v_end AND lg.worker_id = e.worker_id)
        AND (public.is_master(v_uid) OR w.id IS NULL OR public.can_access_company_data(v_uid, _project_id, w.company_id))), '[]'::jsonb)
  );
END;
$function$;
