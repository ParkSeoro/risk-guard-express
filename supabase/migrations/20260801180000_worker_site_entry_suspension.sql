-- Worker site-entry suspension (1일 / 3일 / 영구) + reason.
-- Soft-delete (is_active=false) remains for roster removal; suspension blocks entry only.

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS site_entry_suspended_until timestamptz,
  ADD COLUMN IF NOT EXISTS site_entry_suspension_reason text,
  ADD COLUMN IF NOT EXISTS site_entry_suspension_kind text,
  ADD COLUMN IF NOT EXISTS site_entry_suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS site_entry_suspended_by uuid;

COMMENT ON COLUMN public.workers.site_entry_suspended_until IS
  'NULL = not suspended. Far-future (~infinity) = permanent. Otherwise timed end (Asia/Seoul aware via app).';
COMMENT ON COLUMN public.workers.site_entry_suspension_kind IS
  '1d | 3d | permanent | null';

CREATE OR REPLACE FUNCTION public.is_worker_site_entry_blocked(p_worker_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workers w
    WHERE w.id = p_worker_id
      AND w.is_active = true
      AND w.site_entry_suspended_until IS NOT NULL
      AND w.site_entry_suspended_until > now()
  );
$$;

REVOKE ALL ON FUNCTION public.is_worker_site_entry_blocked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_worker_site_entry_blocked(uuid) TO anon, authenticated, service_role;

-- Manager RPC: set / lift suspension (project-scoped managers + master)
CREATE OR REPLACE FUNCTION public.set_worker_site_entry_suspension(
  _worker_id uuid,
  _kind text,          -- '1d' | '3d' | 'permanent' | 'lift'
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _w record;
  _uid uuid := auth.uid();
  _until timestamptz;
  _is_master boolean;
  _can_manage boolean;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  SELECT * INTO _w FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  _is_master := EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'master'
  );

  _can_manage := _is_master OR EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.user_id = _uid
      AND pm.project_id = _w.project_id
      AND pm.role_new IN (
        'project_admin', 'safety_manager', 'site_manager', 'supervisor', 'site_supervisor'
      )
  );

  IF NOT _can_manage THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  IF _kind = 'lift' THEN
    UPDATE public.workers
       SET site_entry_suspended_until = NULL,
           site_entry_suspension_reason = NULL,
           site_entry_suspension_kind = NULL,
           site_entry_suspended_at = NULL,
           site_entry_suspended_by = NULL
     WHERE id = _worker_id;
    RETURN jsonb_build_object('success', true, 'lifted', true);
  END IF;

  IF _kind NOT IN ('1d', '3d', 'permanent') THEN
    RETURN jsonb_build_object('error', 'INVALID_KIND');
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) < 2 THEN
    RETURN jsonb_build_object('error', 'REASON_REQUIRED');
  END IF;

  IF _kind = '1d' THEN
    _until := now() + interval '1 day';
  ELSIF _kind = '3d' THEN
    _until := now() + interval '3 days';
  ELSE
    -- permanent sentinel (~100 years)
    _until := timestamptz '9999-12-31 00:00:00+00';
  END IF;

  UPDATE public.workers
     SET site_entry_suspended_until = _until,
         site_entry_suspension_reason = trim(_reason),
         site_entry_suspension_kind = _kind,
         site_entry_suspended_at = now(),
         site_entry_suspended_by = _uid
   WHERE id = _worker_id;

  RETURN jsonb_build_object(
    'success', true,
    'kind', _kind,
    'until', _until,
    'reason', trim(_reason)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_worker_site_entry_suspension(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_worker_site_entry_suspension(uuid, text, text) TO authenticated, service_role;

-- Harden worker_entry against suspension
CREATE OR REPLACE FUNCTION public.worker_entry(
  _token TEXT, _work_permit_id UUID, _signature TEXT,
  _ra_confirmed BOOLEAN, _edu_confirmed BOOLEAN, _tbm_confirmed BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _w record;
  _existing UUID;
  _new_id UUID;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT id, project_id, site_entry_suspended_until, site_entry_suspension_reason
    INTO _w
    FROM public.workers
   WHERE qr_token = _token AND is_active = true;

  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  IF _w.site_entry_suspended_until IS NOT NULL AND _w.site_entry_suspended_until > now() THEN
    RETURN jsonb_build_object(
      'error', 'SUSPENDED',
      'until', _w.site_entry_suspended_until,
      'reason', _w.site_entry_suspension_reason
    );
  END IF;

  IF _signature IS NULL OR length(_signature) < 100 THEN
    RETURN jsonb_build_object('error','SIGNATURE_REQUIRED');
  END IF;

  SELECT id INTO _existing FROM public.worker_entry_logs
   WHERE worker_id = _w.id AND exit_at IS NULL
     AND (entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
   LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('error','ALREADY_ENTERED','log_id', _existing);
  END IF;

  INSERT INTO public.worker_entry_logs (
    worker_id, work_permit_id, project_id, entry_signature_data,
    risk_assessment_confirmed, education_confirmed, tbm_confirmed
  ) VALUES (
    _w.id, _work_permit_id, _w.project_id, _signature,
    COALESCE(_ra_confirmed,false), COALESCE(_edu_confirmed,false), COALESCE(_tbm_confirmed,false)
  ) RETURNING id INTO _new_id;

  RETURN jsonb_build_object('success', true, 'log_id', _new_id);
END;
$$;

-- Harden company QR check-in: do not clear suspension; block entry while suspended.
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

  IF _worker_id IS NULL THEN
    INSERT INTO public.workers (project_id, company_id, company_name, name, phone, is_active)
    VALUES (_q.project_id, _q.company_id, _q.company_name, trim(_name), trim(_phone), true)
    RETURNING id INTO _worker_id;
  ELSE
    UPDATE public.workers
       SET company_id = COALESCE(company_id, _q.company_id),
           company_name = COALESCE(NULLIF(company_name,''), _q.company_name),
           -- keep is_active as-is if already false (soft-deleted); only revive inactive=false soft cases carefully
           is_active = CASE WHEN is_active = false THEN is_active ELSE true END,
           updated_at = _now
     WHERE id = _worker_id;
  END IF;

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
