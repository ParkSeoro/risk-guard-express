-- PR 2-B hardening (matching live migration history):
-- 1) Lock `ack_note` against post-ack modification/wiping by non-master users.
-- 2) Ensure `list_attendance_exceptions` `suspended_site_entry` only reports active
--    `inside` presence when `w.site_entry_suspended_until > now()` (so lifted suspensions
--    do not display stale "현장 내 체류중" before the next GPS ping).

CREATE OR REPLACE FUNCTION public.guard_worker_zone_events_ack_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
BEGIN
  IF _uid IS NULL OR public.is_master(_uid) THEN
    IF NEW.ack_note IS NOT NULL THEN
      NEW.ack_note := left(NULLIF(btrim(NEW.ack_note), ''), 500);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.zone_id IS DISTINCT FROM OLD.zone_id
     OR NEW.restricted_zone_id IS DISTINCT FROM OLD.restricted_zone_id
     OR NEW.worker_qr_id IS DISTINCT FROM OLD.worker_qr_id
     OR NEW.worker_name IS DISTINCT FROM OLD.worker_name
     OR NEW.worker_phone IS DISTINCT FROM OLD.worker_phone
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.position_x IS DISTINCT FROM OLD.position_x
     OR NEW.position_y IS DISTINCT FROM OLD.position_y
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.lat IS DISTINCT FROM OLD.lat
     OR NEW.lng IS DISTINCT FROM OLD.lng
     OR NEW.accuracy_m IS DISTINCT FROM OLD.accuracy_m
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'zone_event_immutable_columns'
      USING ERRCODE = '42501', HINT = '구역 출입 이력의 원본 필드는 수정할 수 없습니다.';
  END IF;

  IF OLD.acknowledged = true THEN
    IF NEW.acknowledged IS DISTINCT FROM OLD.acknowledged
       OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by
       OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
       OR NEW.ack_note IS DISTINCT FROM OLD.ack_note THEN
      RAISE EXCEPTION 'zone_event_ack_immutable'
        USING ERRCODE = '42501', HINT = '이미 확인 처리된 구역 경보의 확인자·시각·조치 메모는 변경할 수 없습니다.';
    END IF;
  END IF;

  IF NEW.ack_note IS NOT NULL THEN
    NEW.ack_note := left(NULLIF(btrim(NEW.ack_note), ''), 500);
  END IF;

  IF NEW.acknowledged = true AND OLD.acknowledged IS DISTINCT FROM true THEN
    NEW.acknowledged_by := _uid;
    NEW.acknowledged_at := now();
  END IF;

  RETURN NEW;
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
  v_today date := (timezone('Asia/Seoul', now()))::date;
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
    'suspended_site_entry', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'worker_id', p.worker_id,
        'worker_name', w.name,
        'company_name', w.company_name,
        'detail', CASE
          WHEN p.inside AND w.site_entry_suspended_until IS NOT NULL AND w.site_entry_suspended_until > now()
          THEN COALESCE(NULLIF(btrim(p.spot_name), ''), '현장 내 체류중')
          ELSE '진입 감지'
        END,
        'status', CASE
          WHEN p.inside AND w.site_entry_suspended_until IS NOT NULL AND w.site_entry_suspended_until > now()
          THEN 'inside'
          ELSE 'detected'
        END,
        'updated_at', COALESCE(p.last_alert_at, p.updated_at)
      ) ORDER BY COALESCE(p.last_alert_at, p.updated_at) DESC)
      FROM public.worker_suspension_site_presence p
      JOIN public.workers w ON w.id = p.worker_id
      WHERE p.project_id = _project_id
        AND (
          (v_day = v_today AND p.inside = true AND w.site_entry_suspended_until IS NOT NULL AND w.site_entry_suspended_until > now())
          OR (p.last_alert_at IS NOT NULL AND p.last_alert_at BETWEEN v_start AND v_end)
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
