-- Labor-evidence layer: work hours RPCs, signature ledger, attendance exceptions,
-- admin entry corrections, roster emergency contacts, daily-ack pledge hash.

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS emergency_name text,
  ADD COLUMN IF NOT EXISTS emergency_phone text;

ALTER TABLE public.worker_daily_acks
  ADD COLUMN IF NOT EXISTS pledge_text_hash text;

CREATE TABLE IF NOT EXISTS public.worker_entry_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entry_log_id uuid NOT NULL REFERENCES public.worker_entry_logs(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  before_entry_at timestamptz,
  before_exit_at timestamptz,
  after_entry_at timestamptz,
  after_exit_at timestamptz,
  reason text NOT NULL,
  corrected_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_entry_corrections_log
  ON public.worker_entry_corrections (entry_log_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_entry_corrections_project
  ON public.worker_entry_corrections (project_id, created_at DESC);

ALTER TABLE public.worker_entry_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS worker_entry_corrections_select ON public.worker_entry_corrections;
CREATE POLICY worker_entry_corrections_select
  ON public.worker_entry_corrections FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  );

REVOKE INSERT, UPDATE, DELETE ON public.worker_entry_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.worker_entry_corrections TO authenticated;
GRANT ALL ON public.worker_entry_corrections TO service_role;

CREATE OR REPLACE FUNCTION public.labor_night_minutes(_entry timestamptz, _exit timestamptz)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_day date;
  v_end date;
  v_total numeric := 0;
  v_ws timestamptz;
  v_we timestamptz;
BEGIN
  IF _entry IS NULL OR _exit IS NULL OR _exit <= _entry THEN
    RETURN 0;
  END IF;
  v_day := (_entry AT TIME ZONE 'Asia/Seoul')::date;
  v_end := (_exit AT TIME ZONE 'Asia/Seoul')::date;
  WHILE v_day <= v_end LOOP
    v_ws := (v_day::timestamp AT TIME ZONE 'Asia/Seoul');
    v_we := ((v_day::timestamp + interval '6 hours') AT TIME ZONE 'Asia/Seoul');
    v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(_exit, v_we) - GREATEST(_entry, v_ws))));
    v_ws := ((v_day::timestamp + interval '22 hours') AT TIME ZONE 'Asia/Seoul');
    v_we := (((v_day + 1)::timestamp) AT TIME ZONE 'Asia/Seoul');
    v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(_exit, v_we) - GREATEST(_entry, v_ws))));
    v_day := v_day + 1;
  END LOOP;
  RETURN FLOOR(v_total / 60.0)::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.labor_week_start(_day date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT _day - ((EXTRACT(ISODOW FROM _day)::integer) - 1);
$$;

CREATE OR REPLACE FUNCTION public.labor_assert_project_read(_project_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF _project_id IS NULL THEN
    RAISE EXCEPTION 'project_required';
  END IF;
  IF NOT (
    public.is_master(v_uid)
    OR public.is_project_member(v_uid, _project_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_work_hours_rows(
  _project_id uuid,
  _from date,
  _to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := public.labor_assert_project_read(_project_id);
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.work_date DESC, x.entry_at DESC)
    FROM (
      SELECT
        e.id AS entry_log_id,
        e.worker_id,
        w.name AS worker_name,
        w.phone AS worker_phone,
        COALESCE(NULLIF(trim(w.job_type), ''), '미분류') AS job_type,
        w.company_id,
        COALESCE(NULLIF(trim(w.company_name), ''), '미분류') AS company_name,
        (e.entry_at AT TIME ZONE 'Asia/Seoul')::date AS work_date,
        e.entry_at,
        e.exit_at,
        CASE WHEN e.exit_at IS NULL THEN NULL
             ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (e.exit_at - e.entry_at)) / 60))::int
        END AS minutes,
        CASE WHEN e.exit_at IS NULL THEN NULL
             ELSE GREATEST(0.25, ROUND((GREATEST(0, EXTRACT(EPOCH FROM (e.exit_at - e.entry_at)) / 60) / 480.0)::numeric, 2))
        END AS man_days,
        public.labor_night_minutes(e.entry_at, e.exit_at) AS night_minutes,
        (e.exit_at IS NULL) AS incomplete,
        (EXTRACT(ISODOW FROM (e.entry_at AT TIME ZONE 'Asia/Seoul')::date) = 7) AS sunday,
        e.entry_method,
        e.no_accident_confirmed,
        e.tbm_confirmed,
        e.risk_assessment_confirmed,
        e.education_confirmed,
        EXISTS (
          SELECT 1 FROM public.worker_entry_corrections c WHERE c.entry_log_id = e.id
        ) AS corrected
      FROM public.worker_entry_logs e
      JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id
        AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN _from AND _to
        AND (
          public.is_master(v_uid)
          OR public.can_access_company_data(v_uid, _project_id, w.company_id)
        )
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_work_hours_rollup(
  _project_id uuid,
  _from date,
  _to date,
  _group text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb;
  v_group text := COALESCE(NULLIF(trim(_group), ''), 'worker');
BEGIN
  v_rows := public.get_work_hours_rows(_project_id, _from, _to);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(g) ORDER BY g.minutes DESC, g.label)
    FROM (
      SELECT
        CASE v_group
          WHEN 'job_type' THEN COALESCE(r.job_type, '미분류')
          WHEN 'company' THEN COALESCE(r.company_id::text, r.company_name, '미분류')
          WHEN 'project' THEN _project_id::text
          ELSE r.worker_id::text
        END AS key,
        CASE v_group
          WHEN 'job_type' THEN COALESCE(r.job_type, '미분류')
          WHEN 'company' THEN COALESCE(r.company_name, '미분류')
          WHEN 'project' THEN '전체'
          ELSE COALESCE(r.worker_name, r.worker_id::text)
        END AS label,
        COUNT(DISTINCT r.worker_id)::int AS worker_count,
        COUNT(DISTINCT r.work_date)::int AS day_count,
        COALESCE(SUM(r.minutes) FILTER (WHERE r.minutes IS NOT NULL), 0)::int AS minutes,
        COALESCE(SUM(r.man_days) FILTER (WHERE r.man_days IS NOT NULL), 0) AS man_days,
        COALESCE(SUM(r.night_minutes), 0)::int AS night_minutes,
        COUNT(*) FILTER (WHERE r.incomplete)::int AS incomplete_count,
        COALESCE(SUM(r.minutes) FILTER (WHERE r.sunday AND r.minutes IS NOT NULL), 0)::int AS sunday_minutes
      FROM jsonb_to_recordset(v_rows) AS r(
        worker_id uuid,
        worker_name text,
        job_type text,
        company_id uuid,
        company_name text,
        work_date date,
        minutes int,
        man_days numeric,
        night_minutes int,
        incomplete boolean,
        sunday boolean
      )
      GROUP BY 1, 2
    ) g
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_worker_signature_ledger(
  _project_id uuid,
  _worker_id uuid,
  _from date,
  _to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_from date := COALESCE(_from, CURRENT_DATE - 30);
  v_to date := COALESCE(_to, CURRENT_DATE);
BEGIN
  v_uid := public.labor_assert_project_read(_project_id);

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.signed_at DESC NULLS LAST)
    FROM (
      SELECT
        a.id::text AS id,
        'daily_ack'::text AS kind,
        '일일서약'::text AS kind_label,
        a.worker_id,
        COALESCE(a.worker_name, w.name) AS worker_name,
        w.company_name,
        a.signature_data,
        a.created_at AS signed_at,
        a.pledge_text_hash,
        a.work_summary AS detail,
        a.ack_date::text AS work_date
      FROM public.worker_daily_acks a
      LEFT JOIN public.workers w ON w.id = a.worker_id
      WHERE a.project_id = _project_id
        AND a.ack_date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR a.worker_id = _worker_id)
        AND (
          public.is_master(v_uid)
          OR w.id IS NULL
          OR public.can_access_company_data(v_uid, _project_id, w.company_id)
        )

      UNION ALL

      SELECT
        e.id::text,
        'no_accident',
        '무재해 서약',
        e.worker_id,
        w.name,
        w.company_name,
        e.exit_signature_data,
        COALESCE(e.exit_at, e.entry_at),
        NULL,
        CASE WHEN e.no_accident_confirmed THEN '무재해 확인' ELSE '퇴근 서명' END,
        (e.entry_at AT TIME ZONE 'Asia/Seoul')::date::text
      FROM public.worker_entry_logs e
      JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id
        AND e.exit_signature_data IS NOT NULL
        AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR e.worker_id = _worker_id)
        AND (
          public.is_master(v_uid)
          OR public.can_access_company_data(v_uid, _project_id, w.company_id)
        )

      UNION ALL

      SELECT
        p.id::text,
        'tbm',
        'TBM',
        p.worker_id,
        p.worker_name,
        p.company_name,
        p.signature_data,
        p.participated_at,
        NULL,
        'TBM 참여',
        s.tbm_date::text
      FROM public.tbm_participations p
      JOIN public.tbm_sessions s ON s.id = p.tbm_session_id
      LEFT JOIN public.workers w ON w.id = p.worker_id
      WHERE s.project_id = _project_id
        AND COALESCE(s.is_deleted, false) = false
        AND s.tbm_date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR p.worker_id = _worker_id)
        AND (
          public.is_master(v_uid)
          OR w.id IS NULL
          OR public.can_access_company_data(v_uid, _project_id, w.company_id)
        )

      UNION ALL

      SELECT
        a.id::text,
        'ra_share',
        '위험성평가 공유',
        a.worker_id,
        a.worker_name,
        a.company_name,
        a.signature_data,
        a.signed_at,
        NULL,
        a.source,
        (a.signed_at AT TIME ZONE 'Asia/Seoul')::date::text
      FROM public.assessment_run_share_acks a
      LEFT JOIN public.workers w ON w.id = a.worker_id
      WHERE a.project_id = _project_id
        AND (a.signed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR a.worker_id = _worker_id)
        AND (
          public.is_master(v_uid)
          OR w.id IS NULL
          OR public.can_access_company_data(v_uid, _project_id, w.company_id)
        )

      UNION ALL

      SELECT
        e.id::text,
        'ppe',
        '보호구 수령',
        e.worker_id,
        e.worker_name,
        NULL,
        e.signature_data,
        e.signed_at,
        NULL,
        e.item_name,
        COALESCE(e.issued_at, (e.signed_at AT TIME ZONE 'Asia/Seoul')::date)::text
      FROM public.safety_cost_ppe_ledger_entries e
      LEFT JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id
        AND COALESCE(e.is_deleted, false) = false
        AND e.signature_data IS NOT NULL
        AND COALESCE(e.issued_at, (e.signed_at AT TIME ZONE 'Asia/Seoul')::date) BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR e.worker_id = _worker_id)
        AND (
          public.is_master(v_uid)
          OR w.id IS NULL
          OR public.can_access_company_data(v_uid, _project_id, w.company_id)
        )
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_attendance_exceptions(
  _project_id uuid,
  _date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    'missing_attendance', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name, 'job_type', w.job_type
      ) ORDER BY w.company_name, w.name)
      FROM public.workers w
      WHERE w.project_id = _project_id
        AND COALESCE(w.is_active, true)
        AND (w.site_entry_suspended_until IS NULL OR w.site_entry_suspended_until <= now())
        AND NOT EXISTS (
          SELECT 1 FROM public.worker_entry_logs e
          WHERE e.worker_id = w.id AND e.project_id = _project_id
            AND e.entry_at BETWEEN v_start AND v_end
        )
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ), '[]'::jsonb),
    'missing_exit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name,
        'entry_log_id', e.id, 'entry_at', e.entry_at, 'work_date', (e.entry_at AT TIME ZONE 'Asia/Seoul')::date
      ) ORDER BY e.entry_at)
      FROM public.worker_entry_logs e
      JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id
        AND e.exit_at IS NULL
        AND e.entry_at < v_end
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ), '[]'::jsonb),
    'missing_daily_ack', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name, 'entry_at', e.entry_at
      ) ORDER BY w.name)
      FROM public.worker_entry_logs e
      JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id
        AND e.entry_at BETWEEN v_start AND v_end
        AND NOT EXISTS (
          SELECT 1 FROM public.worker_daily_acks a
          WHERE a.project_id = _project_id AND a.worker_id = e.worker_id AND a.ack_date = v_day
        )
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ), '[]'::jsonb),
    'missing_tbm', CASE WHEN NOT v_has_tbm THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name
      ) ORDER BY w.name)
      FROM public.worker_entry_logs e
      JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id
        AND e.entry_at BETWEEN v_start AND v_end
        AND COALESCE(e.tbm_confirmed, false) = false
        AND NOT EXISTS (
          SELECT 1
          FROM public.tbm_participations p
          JOIN public.tbm_sessions s ON s.id = p.tbm_session_id
          WHERE s.project_id = _project_id AND s.tbm_date = v_day
            AND COALESCE(s.is_deleted, false) = false
            AND COALESCE(p.briefing_confirmed, true)
            AND (p.worker_id = e.worker_id OR regexp_replace(COALESCE(p.worker_phone, ''), '\D', '', 'g')
               = regexp_replace(COALESCE(w.phone, ''), '\D', '', 'g'))
        )
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ), '[]'::jsonb) END,
    'duplicate_entry', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', d.worker_id, 'worker_name', w.name, 'company_name', w.company_name, 'count', d.cnt
      ) ORDER BY w.name)
      FROM (
        SELECT e.worker_id, COUNT(*)::int AS cnt
        FROM public.worker_entry_logs e
        WHERE e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end
        GROUP BY e.worker_id
        HAVING COUNT(*) > 1
      ) d
      JOIN public.workers w ON w.id = d.worker_id
      WHERE public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id)
    ), '[]'::jsonb),
    'overdue_required', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name,
        'item_type', r.item_type, 'subtype', r.subtype, 'due_date', r.due_date, 'status', r.status
      ) ORDER BY r.due_date)
      FROM public.worker_required_items r
      JOIN public.workers w ON w.id = r.worker_id
      WHERE r.project_id = _project_id
        AND COALESCE(r.is_deleted, false) = false
        AND r.status IN ('overdue', 'due')
        AND (r.due_date IS NULL OR r.due_date <= v_day)
        AND r.status <> 'done'
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ), '[]'::jsonb),
    'missing_health_log', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name
      ) ORDER BY w.name)
      FROM public.workers w
      WHERE w.project_id = _project_id
        AND COALESCE(w.is_active, true)
        AND COALESCE(w.requires_daily_health_log, false)
        AND EXISTS (
          SELECT 1 FROM public.worker_entry_logs e
          WHERE e.worker_id = w.id AND e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.worker_daily_health_logs h
          WHERE h.worker_id = w.id AND h.log_date = v_day AND COALESCE(h.is_deleted, false) = false
        )
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ), '[]'::jsonb),
    'gps_blocked', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', st.worker_id, 'worker_name', w.name, 'company_name', w.company_name,
        'block_reason', st.block_reason, 'updated_at', st.updated_at
      ) ORDER BY st.updated_at DESC)
      FROM public.worker_gps_status st
      JOIN public.workers w ON w.id = st.worker_id
      WHERE st.project_id = _project_id
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ), '[]'::jsonb),
    'permit_no_show', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', w.id, 'worker_name', w.name, 'company_name', w.company_name,
        'work_permit_id', pw.work_permit_id, 'work_name', COALESCE(p.work_name, '')
      ) ORDER BY w.name)
      FROM public.work_permit_workers pw
      JOIN public.work_permits p ON p.id = pw.work_permit_id
      JOIN public.workers w ON w.id = pw.worker_id
      WHERE pw.project_id = _project_id
        AND p.permit_date = v_day
        AND COALESCE(p.is_deleted, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM public.worker_entry_logs e
          WHERE e.worker_id = pw.worker_id AND e.project_id = _project_id AND e.entry_at BETWEEN v_start AND v_end
        )
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ), '[]'::jsonb),
    'ppe_pending', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_id', e.worker_id, 'worker_name', e.worker_name, 'item_name', e.item_name, 'issued_at', e.issued_at
      ) ORDER BY e.issued_at DESC)
      FROM public.safety_cost_ppe_ledger_entries e
      LEFT JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id
        AND COALESCE(e.is_deleted, false) = false
        AND e.receipt_status = 'pending'
        AND EXISTS (
          SELECT 1 FROM public.worker_entry_logs lg
          WHERE lg.project_id = _project_id
            AND lg.entry_at BETWEEN v_start AND v_end
            AND (lg.worker_id = e.worker_id)
        )
        AND (public.is_master(v_uid) OR w.id IS NULL OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_worker_entry_log(
  _entry_log_id uuid,
  _entry_at timestamptz,
  _exit_at timestamptz,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_e public.worker_entry_logs%ROWTYPE;
  v_company uuid;
  v_corr uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF COALESCE(trim(_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF _entry_at IS NULL THEN RAISE EXCEPTION 'entry_required'; END IF;
  IF _exit_at IS NOT NULL AND _exit_at < _entry_at THEN RAISE EXCEPTION 'invalid_range'; END IF;

  SELECT * INTO v_e FROM public.worker_entry_logs WHERE id = _entry_log_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;

  SELECT company_id INTO v_company FROM public.workers WHERE id = v_e.worker_id;
  IF NOT (
    public.is_master(v_uid)
    OR public.can_write_company_data(v_uid, v_e.project_id, v_company)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.worker_entry_corrections (
    project_id, entry_log_id, worker_id,
    before_entry_at, before_exit_at, after_entry_at, after_exit_at,
    reason, corrected_by
  ) VALUES (
    v_e.project_id, v_e.id, v_e.worker_id,
    v_e.entry_at, v_e.exit_at, _entry_at, _exit_at,
    trim(_reason), v_uid
  ) RETURNING id INTO v_corr;

  UPDATE public.worker_entry_logs
     SET entry_at = _entry_at,
         exit_at = _exit_at
   WHERE id = v_e.id;

  RETURN jsonb_build_object(
    'ok', true,
    'correction_id', v_corr,
    'entry_log_id', v_e.id,
    'entry_at', _entry_at,
    'exit_at', _exit_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_worker_profile_identity(
  _worker_id uuid,
  _name text,
  _phone text,
  _job_type text,
  _birth_date date,
  _hire_date date,
  _emergency_name text,
  _emergency_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w public.workers%ROWTYPE;
  v_phone text;
  v_old_digits text;
  v_new_digits text;
  v_updated int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_w FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'worker_not_found'; END IF;
  IF NOT (
    public.is_master(v_uid)
    OR public.can_write_company_data(v_uid, v_w.project_id, v_w.company_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_phone := COALESCE(NULLIF(trim(_phone), ''), v_w.phone);
  v_old_digits := regexp_replace(COALESCE(v_w.phone, ''), '\D', '', 'g');
  v_new_digits := regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g');

  UPDATE public.workers
     SET name = COALESCE(NULLIF(trim(_name), ''), name),
         phone = v_phone,
         job_type = COALESCE(NULLIF(trim(_job_type), ''), job_type),
         birth_date = COALESCE(_birth_date, birth_date),
         hire_date = COALESCE(_hire_date, hire_date),
         emergency_name = NULLIF(trim(COALESCE(_emergency_name, '')), ''),
         emergency_phone = NULLIF(trim(COALESCE(_emergency_phone, '')), ''),
         updated_at = now()
   WHERE id = _worker_id;

  UPDATE public.profiles p
     SET display_name = COALESCE(NULLIF(trim(_name), ''), p.display_name),
         phone = CASE WHEN v_new_digits <> '' THEN v_phone ELSE p.phone END
   WHERE regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') IN (v_old_digits, v_new_digits)
     AND COALESCE(v_old_digits, '') <> '';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'worker_id', _worker_id, 'profiles_updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.labor_night_minutes(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.labor_week_start(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.labor_assert_project_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labor_night_minutes(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labor_week_start(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labor_assert_project_read(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_work_hours_rows(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_work_hours_rollup(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_worker_signature_ledger(uuid, uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_attendance_exceptions(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_worker_entry_log(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_worker_profile_identity(uuid, text, text, text, date, date, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_work_hours_rows(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_work_hours_rollup(uuid, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_worker_signature_ledger(uuid, uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_attendance_exceptions(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_worker_entry_log(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_worker_profile_identity(uuid, text, text, text, date, date, text, text) TO authenticated, service_role;

COMMENT ON TABLE public.worker_entry_corrections IS
  'Admin audit trail for worker_entry_logs time corrections. Not a payroll adjustment.';
COMMENT ON FUNCTION public.get_work_hours_rows(uuid, date, date) IS
  'Measured on-site minutes/man-days from GPS entry logs. Not a wage basis.';
