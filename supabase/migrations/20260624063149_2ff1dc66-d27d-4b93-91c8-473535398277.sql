
-- ============================================================
-- Phase A foundation: attendance SSOT + integrity diagnostics
-- ============================================================

-- 1) Unified attendance SSOT view (QR + entry log + TBM)
DROP VIEW IF EXISTS public.v_worker_attendance_today CASCADE;
CREATE VIEW public.v_worker_attendance_today
WITH (security_invoker = on) AS
WITH today AS (
  SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d
),
qr_src AS (
  SELECT w.id AS worker_id, w.project_id, w.company_id, w.name, w.company_name,
         dq.work_date AS att_date,
         CASE WHEN dq.used_for_entry THEN 'qr' ELSE NULL END AS entry_src,
         CASE WHEN dq.used_for_exit  THEN 'qr' ELSE NULL END AS exit_src
  FROM public.worker_daily_qr dq
  JOIN public.workers w ON w.id = dq.worker_id
  WHERE dq.work_date = (SELECT d FROM today)
),
entry_src AS (
  SELECT wel.worker_id, w.project_id, w.company_id, w.name, w.company_name,
         (wel.entry_at AT TIME ZONE 'Asia/Seoul')::date AS att_date,
         MIN(wel.entry_at) AS entry_at,
         MAX(wel.exit_at)  AS exit_at
  FROM public.worker_entry_logs wel
  JOIN public.workers w ON w.id = wel.worker_id
  WHERE (wel.entry_at AT TIME ZONE 'Asia/Seoul')::date = (SELECT d FROM today)
  GROUP BY wel.worker_id, w.project_id, w.company_id, w.name, w.company_name,
           (wel.entry_at AT TIME ZONE 'Asia/Seoul')::date
),
tbm_src AS (
  SELECT w.id AS worker_id, w.project_id, w.company_id, w.name, w.company_name,
         (tp.participated_at AT TIME ZONE 'Asia/Seoul')::date AS att_date,
         MIN(tp.participated_at) AS tbm_at
  FROM public.tbm_participations tp
  JOIN public.workers w
    ON lower(trim(w.phone)) = lower(trim(tp.worker_phone))
   AND lower(trim(w.name))  = lower(trim(tp.worker_name))
  WHERE (tp.participated_at AT TIME ZONE 'Asia/Seoul')::date = (SELECT d FROM today)
    AND COALESCE(tp.briefing_confirmed, false) = true
  GROUP BY w.id, w.project_id, w.company_id, w.name, w.company_name,
           (tp.participated_at AT TIME ZONE 'Asia/Seoul')::date
)
SELECT
  COALESCE(e.worker_id, q.worker_id, t.worker_id)       AS worker_id,
  COALESCE(e.project_id, q.project_id, t.project_id)    AS project_id,
  COALESCE(e.company_id, q.company_id, t.company_id)    AS company_id,
  COALESCE(e.name, q.name, t.name)                      AS worker_name,
  COALESCE(e.company_name, q.company_name, t.company_name) AS company_name,
  COALESCE(e.att_date, q.att_date, t.att_date)          AS work_date,
  e.entry_at,
  e.exit_at,
  t.tbm_at,
  (q.entry_src IS NOT NULL OR e.entry_at IS NOT NULL OR t.tbm_at IS NOT NULL) AS attended,
  (e.exit_at IS NOT NULL) AS exited,
  CASE
    WHEN e.entry_at IS NOT NULL THEN 'entry_log'
    WHEN q.entry_src IS NOT NULL THEN 'qr'
    WHEN t.tbm_at  IS NOT NULL THEN 'tbm'
    ELSE NULL
  END AS attendance_source
FROM entry_src e
FULL OUTER JOIN qr_src  q ON q.worker_id = e.worker_id AND q.att_date = e.att_date
FULL OUTER JOIN tbm_src t ON t.worker_id = COALESCE(e.worker_id, q.worker_id)
                          AND t.att_date  = COALESCE(e.att_date,  q.att_date);

GRANT SELECT ON public.v_worker_attendance_today TO authenticated;
GRANT SELECT ON public.v_worker_attendance_today TO service_role;

-- 2) Cross-table integrity check (callable from verification engine)
CREATE OR REPLACE FUNCTION public.check_data_integrity(_project_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _findings jsonb := '[]'::jsonb;
  _c int;
BEGIN
  -- Caller must be master or project member
  IF NOT (public.is_master(auth.uid())
          OR (_project_id IS NOT NULL AND public.is_project_member(auth.uid(), _project_id))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- L1: project_members with role but no profile linkage
  SELECT COUNT(*) INTO _c FROM public.project_members pm
   LEFT JOIN public.profiles p ON p.user_id = pm.user_id
   WHERE p.user_id IS NULL
     AND (_project_id IS NULL OR pm.project_id = _project_id);
  IF _c > 0 THEN
    _findings := _findings || jsonb_build_array(jsonb_build_object(
      'code','PM_PROFILE_ORPHAN','severity','high','count',_c,
      'message','project_members rows without matching profile'));
  END IF;

  -- L2: workers without company_id linkage
  SELECT COUNT(*) INTO _c FROM public.workers w
   WHERE w.is_active = true AND w.company_id IS NULL
     AND (_project_id IS NULL OR w.project_id = _project_id);
  IF _c > 0 THEN
    _findings := _findings || jsonb_build_array(jsonb_build_object(
      'code','WORKER_NO_COMPANY','severity','medium','count',_c,
      'message','active workers without company_id (multi-company filters will skip them)'));
  END IF;

  -- L2/L9: today's entry logs that have no matching daily_qr (legacy/disconnected entry)
  SELECT COUNT(*) INTO _c
    FROM public.worker_entry_logs wel
   WHERE wel.daily_qr_id IS NULL
     AND (wel.entry_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
     AND (_project_id IS NULL OR wel.project_id = _project_id);
  IF _c > 0 THEN
    _findings := _findings || jsonb_build_array(jsonb_build_object(
      'code','ENTRY_NO_DAILY_QR','severity','low','count',_c,
      'message','today entry logs not linked to a daily QR (attendance dashboards may differ)'));
  END IF;

  -- L3: project_members.company text differs from companies.name (legacy drift)
  SELECT COUNT(*) INTO _c FROM public.project_members pm
   JOIN public.companies c ON c.id = pm.company_id
   WHERE pm.company IS NOT NULL AND pm.company <> '' AND pm.company <> c.name
     AND (_project_id IS NULL OR pm.project_id = _project_id);
  IF _c > 0 THEN
    _findings := _findings || jsonb_build_array(jsonb_build_object(
      'code','PM_COMPANY_TEXT_DRIFT','severity','low','count',_c,
      'message','project_members.company text differs from companies.name (use company_id only)'));
  END IF;

  -- L4: high-risk items without legal_duty / todo follow-up
  SELECT COUNT(*) INTO _c FROM public.risk_items ri
   WHERE COALESCE(ri.is_deleted,false) = false
     AND COALESCE(ri.risk_score, ri.severity * ri.probability) >= 6
     AND (_project_id IS NULL OR ri.project_id = _project_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.todo_items td
        WHERE td.source_table = 'risk_items' AND td.source_id = ri.id
          AND COALESCE(td.is_deleted,false) = false
     );
  IF _c > 0 THEN
    _findings := _findings || jsonb_build_array(jsonb_build_object(
      'code','HIGH_RISK_NO_TODO','severity','high','count',_c,
      'message','high risk items (>=6) without a follow-up todo'));
  END IF;

  -- L6: carcinogenic chemicals registered but no special health checkup target
  SELECT COUNT(*) INTO _c FROM public.chemicals ch
   WHERE COALESCE(ch.is_deleted,false) = false
     AND (ch.is_carcinogen = true OR ch.is_reproductive_toxin = true)
     AND (_project_id IS NULL OR ch.project_id = _project_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.health_checkups hc
        WHERE hc.project_id = ch.project_id
          AND COALESCE(hc.is_deleted,false) = false
          AND hc.type::text ILIKE '%special%'
     );
  IF _c > 0 THEN
    _findings := _findings || jsonb_build_array(jsonb_build_object(
      'code','CARCINOGEN_NO_SPECIAL_CHECKUP','severity','high','count',_c,
      'message','carcinogen/repro-toxin MSDS registered but no special health checkup recorded'));
  END IF;

  -- Lg2: env measurements older than 6 months without follow-up
  SELECT COUNT(*) INTO _c FROM (
    SELECT factor_id, MAX(measured_at) AS last_at, project_id
      FROM public.work_env_measurements
     WHERE COALESCE(is_deleted,false) = false
       AND (_project_id IS NULL OR project_id = _project_id)
     GROUP BY factor_id, project_id
  ) s WHERE s.last_at < now() - INTERVAL '6 months';
  IF _c > 0 THEN
    _findings := _findings || jsonb_build_array(jsonb_build_object(
      'code','ENV_MEASUREMENT_OVERDUE','severity','high','count',_c,
      'message','factors with no measurement in 6 months (시행규칙 §202)'));
  END IF;

  RETURN jsonb_build_object(
    'checked_at', now(),
    'project_id', _project_id,
    'findings', _findings,
    'total_findings', jsonb_array_length(_findings)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_data_integrity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_data_integrity(uuid) TO service_role;
