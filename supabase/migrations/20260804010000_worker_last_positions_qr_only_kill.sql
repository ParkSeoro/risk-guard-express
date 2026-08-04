-- S3: last-known GPS store + kill QR-only worker creation paths
-- Distribution map reads aggregates (company/zone/count) via RPC.

-- 1) Last-known positions (one row per worker)
CREATE TABLE IF NOT EXISTS public.worker_last_positions (
  worker_id uuid PRIMARY KEY REFERENCES public.workers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  zone_id uuid NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m double precision NULL,
  source text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_last_positions_project
  ON public.worker_last_positions (project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_last_positions_project_zone
  ON public.worker_last_positions (project_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_worker_last_positions_company
  ON public.worker_last_positions (project_id, company_id);

ALTER TABLE public.worker_last_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS worker_last_positions_select ON public.worker_last_positions;
CREATE POLICY worker_last_positions_select ON public.worker_last_positions
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR (
      company_id IS NOT NULL
      AND public.can_access_company_data(auth.uid(), project_id, company_id)
    )
  );

-- Writes go through service role (track-location edge). No direct client insert.
REVOKE INSERT, UPDATE, DELETE ON public.worker_last_positions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.worker_last_positions TO authenticated;
GRANT ALL ON public.worker_last_positions TO service_role;

-- 2) Aggregated distribution counts (no PII)
CREATE OR REPLACE FUNCTION public.get_worker_distribution_counts(_project_id uuid)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  zone_id uuid,
  headcount bigint,
  stale_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _ctype text;
  _my_company uuid;
  _is_master boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  _is_master := public.is_master(_uid);

  SELECT pm.role_new::text, c.type::text, pm.company_id
    INTO _role, _ctype, _my_company
    FROM public.project_members pm
    LEFT JOIN public.companies c ON c.id = pm.company_id
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
  WITH scoped AS (
    SELECT
      wlp.company_id,
      COALESCE(c.name, '(미지정)') AS company_name,
      wlp.zone_id,
      wlp.updated_at
    FROM public.worker_last_positions wlp
    LEFT JOIN public.companies c ON c.id = wlp.company_id
    WHERE wlp.project_id = _project_id
      AND wlp.updated_at >= (now() - interval '12 hours')
      AND (
        _is_master
        OR public.can_access_company_data(_uid, _project_id, wlp.company_id)
      )
  )
  SELECT
    s.company_id,
    s.company_name,
    s.zone_id,
    count(*)::bigint AS headcount,
    count(*) FILTER (WHERE s.updated_at < (now() - interval '30 minutes'))::bigint AS stale_count
  FROM scoped s
  GROUP BY s.company_id, s.company_name, s.zone_id
  ORDER BY s.company_name, s.zone_id NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_worker_distribution_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_worker_distribution_counts(uuid) TO authenticated, service_role;

-- 3) Kill anon register_worker (accounts required)
REVOKE EXECUTE ON FUNCTION public.register_worker(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_worker(uuid, text, text, text, uuid) TO authenticated, service_role;

-- 4) company_qr_check_in: require existing roster worker (no QR-only create)
CREATE OR REPLACE FUNCTION public.company_qr_check_in(
  _token text,
  _name text,
  _phone text,
  _action text,
  _signature text,
  _ra_confirmed boolean DEFAULT false,
  _edu_confirmed boolean DEFAULT false,
  _tbm_confirmed boolean DEFAULT false,
  _no_accident boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _q record;
  _now timestamptz := now();
  _worker_id uuid;
  _open_log uuid;
  _new_log uuid;
  _susp_until timestamptz;
  _susp_reason text;
BEGIN
  IF _signature IS NULL OR length(_signature) < 100 THEN
    RETURN jsonb_build_object('error','SIGNATURE_REQUIRED');
  END IF;
  IF _action NOT IN ('entry','exit') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RETURN jsonb_build_object('error','INVALID_NAME');
  END IF;
  IF _phone IS NULL OR length(trim(_phone)) < 8 THEN
    RETURN jsonb_build_object('error','INVALID_PHONE');
  END IF;

  SELECT cdq.id, cdq.project_id, cdq.company_id, cdq.work_date, cdq.expires_at,
         c.name AS company_name
    INTO _q
    FROM public.company_daily_qr cdq
    JOIN public.companies c ON c.id = cdq.company_id
   WHERE cdq.qr_token = _token
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','INVALID_TOKEN'); END IF;
  IF _q.expires_at < _now THEN
    RETURN jsonb_build_object('error','EXPIRED','message','QR이 만료되었습니다. 관리자에게 새 QR을 요청하세요.');
  END IF;

  SELECT id, site_entry_suspended_until, site_entry_suspension_reason
    INTO _worker_id, _susp_until, _susp_reason
    FROM public.workers
   WHERE project_id = _q.project_id AND phone = trim(_phone)
   LIMIT 1;

  -- QR-only create removed: must already be on roster (Auth signup path)
  IF _worker_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'WORKER_NOT_REGISTERED',
      'message', '등록된 근로자 계정이 없습니다. 근로자 등록 QR로 회원가입 후 이용하세요.'
    );
  END IF;

  UPDATE public.workers
     SET company_id = COALESCE(company_id, _q.company_id),
         company_name = COALESCE(NULLIF(company_name,''), _q.company_name),
         is_active = CASE WHEN is_active = false THEN is_active ELSE true END,
         updated_at = _now
   WHERE id = _worker_id;

  IF _action = 'entry'
     AND _susp_until IS NOT NULL
     AND _susp_until > _now THEN
    RETURN jsonb_build_object(
      'error', 'SUSPENDED',
      'until', _susp_until,
      'reason', _susp_reason
    );
  END IF;

  IF _action = 'entry' THEN
    SELECT id INTO _open_log FROM public.worker_entry_logs
     WHERE worker_id = _worker_id AND exit_at IS NULL
       AND (entry_at AT TIME ZONE 'Asia/Seoul')::date = _q.work_date
     LIMIT 1;
    IF _open_log IS NOT NULL THEN
      RETURN jsonb_build_object('error','ALREADY_ENTERED','log_id',_open_log);
    END IF;

    INSERT INTO public.worker_entry_logs (
      worker_id, project_id, company_daily_qr_id, entry_at, entry_signature_data,
      risk_assessment_confirmed, education_confirmed, tbm_confirmed, entry_method
    ) VALUES (
      _worker_id, _q.project_id, _q.id, _now, _signature,
      COALESCE(_ra_confirmed,false), COALESCE(_edu_confirmed,false), COALESCE(_tbm_confirmed,false),
      'company_qr'
    ) RETURNING id INTO _new_log;

    RETURN jsonb_build_object('success', true, 'action','entry', 'log_id', _new_log,
      'worker_name', trim(_name), 'company_name', _q.company_name);
  ELSE
    IF NOT COALESCE(_no_accident,false) THEN
      RETURN jsonb_build_object('error','NO_ACCIDENT_REQUIRED');
    END IF;
    SELECT id INTO _open_log FROM public.worker_entry_logs
     WHERE worker_id = _worker_id AND exit_at IS NULL
       AND (entry_at AT TIME ZONE 'Asia/Seoul')::date = _q.work_date
     ORDER BY entry_at DESC LIMIT 1;
    IF _open_log IS NULL THEN
      RETURN jsonb_build_object('error','NO_OPEN_ENTRY','message','오늘 출근 기록이 없습니다.');
    END IF;
    UPDATE public.worker_entry_logs
       SET exit_at = _now, exit_signature_data = _signature, no_accident_confirmed = true
     WHERE id = _open_log;

    RETURN jsonb_build_object('success', true, 'action','exit', 'log_id', _open_log,
      'worker_name', trim(_name), 'company_name', _q.company_name);
  END IF;
END;
$$;
