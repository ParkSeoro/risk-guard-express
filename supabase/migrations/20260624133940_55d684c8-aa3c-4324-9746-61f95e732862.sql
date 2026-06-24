
-- 1. Table
CREATE TABLE IF NOT EXISTS public.company_daily_qr (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  qr_token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_company_daily_qr_project_date
  ON public.company_daily_qr (project_id, work_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_daily_qr TO authenticated;
GRANT ALL ON public.company_daily_qr TO service_role;

ALTER TABLE public.company_daily_qr ENABLE ROW LEVEL SECURITY;

CREATE POLICY cdq_select ON public.company_daily_qr FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.is_project_member(auth.uid(), project_id));

CREATE POLICY cdq_admin_write ON public.company_daily_qr FOR ALL TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_project_role(auth.uid(), project_id,
        ARRAY['project_admin','safety_manager']::project_role[])
  )
  WITH CHECK (
    public.is_master(auth.uid())
    OR public.has_project_role(auth.uid(), project_id,
        ARRAY['project_admin','safety_manager']::project_role[])
  );

-- 2. Add column to worker_entry_logs so we can trace check-ins from company QR
ALTER TABLE public.worker_entry_logs
  ADD COLUMN IF NOT EXISTS company_daily_qr_id uuid REFERENCES public.company_daily_qr(id) ON DELETE SET NULL;

-- 3. Function: issue or fetch today's QR for a company
CREATE OR REPLACE FUNCTION public.issue_company_daily_qr(_company_id uuid, _work_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c record;
  _date date := COALESCE(_work_date, (now() AT TIME ZONE 'Asia/Seoul')::date);
  _expires timestamptz := ((_date + 1)::timestamp AT TIME ZONE 'Asia/Seoul');
  _existing record;
  _new_token text;
  _new_id uuid;
BEGIN
  SELECT id, project_id, name INTO _c FROM public.companies WHERE id = _company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','COMPANY_NOT_FOUND'); END IF;

  IF NOT (public.is_master(auth.uid())
          OR public.has_project_role(auth.uid(), _c.project_id,
                ARRAY['project_admin','safety_manager']::project_role[])) THEN
    RETURN jsonb_build_object('error','FORBIDDEN');
  END IF;

  SELECT id, qr_token, expires_at INTO _existing
    FROM public.company_daily_qr
   WHERE company_id = _company_id AND work_date = _date
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'qr_token', _existing.qr_token,
      'work_date', _date, 'expires_at', _existing.expires_at, 'company_name', _c.name);
  END IF;

  _new_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO public.company_daily_qr (project_id, company_id, work_date, qr_token, expires_at, issued_by)
  VALUES (_c.project_id, _company_id, _date, _new_token, _expires, auth.uid())
  RETURNING id INTO _new_id;

  RETURN jsonb_build_object('success', true, 'qr_token', _new_token,
    'work_date', _date, 'expires_at', _expires, 'company_name', _c.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_company_daily_qr(uuid, date) TO authenticated;

-- 4. Function: worker scans the printed QR (anonymous), provides phone + name
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

  -- Find or create worker by (project, phone)
  SELECT id INTO _worker_id FROM public.workers
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
           is_active = true,
           updated_at = _now
     WHERE id = _worker_id;
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

GRANT EXECUTE ON FUNCTION public.company_qr_check_in(text, text, text, text, text, boolean, boolean, boolean, boolean) TO anon, authenticated;

-- 5. Lookup function for the scan page (returns company context only)
CREATE OR REPLACE FUNCTION public.get_company_qr_by_token(_token text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'company_id', cdq.company_id,
    'company_name', c.name,
    'project_id', cdq.project_id,
    'work_date', cdq.work_date,
    'expires_at', cdq.expires_at,
    'expired', cdq.expires_at < now()
  )
  FROM public.company_daily_qr cdq
  JOIN public.companies c ON c.id = cdq.company_id
  WHERE cdq.qr_token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_qr_by_token(text) TO anon, authenticated;
