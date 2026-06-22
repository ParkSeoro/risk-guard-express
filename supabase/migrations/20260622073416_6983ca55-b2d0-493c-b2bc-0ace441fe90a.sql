
-- 1) 일일 QR 테이블
CREATE TABLE IF NOT EXISTS public.worker_daily_qr (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  qr_token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_for_entry boolean NOT NULL DEFAULT false,
  used_for_exit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (worker_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_worker_daily_qr_token ON public.worker_daily_qr(qr_token);
CREATE INDEX IF NOT EXISTS idx_worker_daily_qr_worker_date ON public.worker_daily_qr(worker_id, work_date);

GRANT SELECT ON public.worker_daily_qr TO anon;
GRANT SELECT, INSERT, UPDATE ON public.worker_daily_qr TO authenticated;
GRANT ALL ON public.worker_daily_qr TO service_role;

ALTER TABLE public.worker_daily_qr ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_qr_select_member" ON public.worker_daily_qr
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "daily_qr_insert_member" ON public.worker_daily_qr
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id));

-- 워커 본인 조회용 (qr_token 으로 익명 조회는 RPC 로만)
-- anon SELECT 권한은 토큰으로 RPC 호출하는 흐름을 위해 비공개 유지.

-- 2) 출퇴근 로그에 daily_qr_id 연결 컬럼
ALTER TABLE public.worker_entry_logs
  ADD COLUMN IF NOT EXISTS daily_qr_id uuid REFERENCES public.worker_daily_qr(id);

-- 3) RPC: 오늘의 QR 발급 또는 조회
CREATE OR REPLACE FUNCTION public.issue_daily_qr(_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _w record;
  _existing record;
  _new_token text;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  _expires timestamptz := ((_today + 1)::timestamp AT TIME ZONE 'Asia/Seoul');
BEGIN
  SELECT id, project_id, name, company_id, company_name
    INTO _w FROM public.workers WHERE id = _worker_id AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'WORKER_NOT_FOUND');
  END IF;

  SELECT id, qr_token, expires_at, used_for_entry, used_for_exit
    INTO _existing
    FROM public.worker_daily_qr
   WHERE worker_id = _worker_id AND work_date = _today
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'qr_token', _existing.qr_token,
      'work_date', _today,
      'expires_at', _existing.expires_at,
      'used_for_entry', _existing.used_for_entry,
      'used_for_exit', _existing.used_for_exit,
      'worker_name', _w.name,
      'company_name', COALESCE(_w.company_name, '')
    );
  END IF;

  _new_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO public.worker_daily_qr (worker_id, project_id, work_date, qr_token, expires_at)
  VALUES (_worker_id, _w.project_id, _today, _new_token, _expires);

  RETURN jsonb_build_object(
    'success', true,
    'qr_token', _new_token,
    'work_date', _today,
    'expires_at', _expires,
    'used_for_entry', false,
    'used_for_exit', false,
    'worker_name', _w.name,
    'company_name', COALESCE(_w.company_name, '')
  );
END;
$$;

-- 4) RPC: 일일 QR 토큰으로 출퇴근 처리
CREATE OR REPLACE FUNCTION public.worker_daily_scan(
  _token text,
  _action text,         -- 'entry' | 'exit'
  _signature text,
  _ra_confirmed boolean DEFAULT false,
  _edu_confirmed boolean DEFAULT false,
  _tbm_confirmed boolean DEFAULT false,
  _no_accident boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _q record;
  _open_log uuid;
  _new_log uuid;
  _now timestamptz := now();
BEGIN
  IF _signature IS NULL OR length(_signature) < 100 THEN
    RETURN jsonb_build_object('error', 'SIGNATURE_REQUIRED');
  END IF;
  IF _action NOT IN ('entry','exit') THEN
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
  END IF;

  SELECT dq.id, dq.worker_id, dq.project_id, dq.work_date, dq.expires_at,
         dq.used_for_entry, dq.used_for_exit, w.name, w.company_name
    INTO _q
    FROM public.worker_daily_qr dq
    JOIN public.workers w ON w.id = dq.worker_id
   WHERE dq.qr_token = _token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_TOKEN');
  END IF;

  IF _q.expires_at < _now THEN
    RETURN jsonb_build_object('error', 'EXPIRED', 'message', '오늘자 QR이 만료되었습니다. 새 QR을 발급받아주세요.');
  END IF;

  IF _action = 'entry' THEN
    IF _q.used_for_entry THEN
      RETURN jsonb_build_object('error', 'ALREADY_ENTERED');
    END IF;
    INSERT INTO public.worker_entry_logs (
      worker_id, project_id, daily_qr_id, entry_at, entry_signature_data,
      risk_assessment_confirmed, education_confirmed, tbm_confirmed, entry_method
    ) VALUES (
      _q.worker_id, _q.project_id, _q.id, _now, _signature,
      COALESCE(_ra_confirmed,false), COALESCE(_edu_confirmed,false), COALESCE(_tbm_confirmed,false),
      'self_qr'
    ) RETURNING id INTO _new_log;
    UPDATE public.worker_daily_qr SET used_for_entry = true WHERE id = _q.id;
    RETURN jsonb_build_object('success', true, 'action', 'entry', 'log_id', _new_log,
      'worker_name', _q.name, 'company_name', COALESCE(_q.company_name,''));
  ELSE
    IF NOT COALESCE(_no_accident,false) THEN
      RETURN jsonb_build_object('error', 'NO_ACCIDENT_REQUIRED');
    END IF;
    SELECT id INTO _open_log FROM public.worker_entry_logs
     WHERE daily_qr_id = _q.id AND exit_at IS NULL LIMIT 1;
    IF _open_log IS NULL THEN
      RETURN jsonb_build_object('error', 'NO_OPEN_ENTRY', 'message', '오늘 출근 기록이 없습니다.');
    END IF;
    UPDATE public.worker_entry_logs
      SET exit_at = _now,
          exit_signature_data = _signature,
          no_accident_confirmed = true
    WHERE id = _open_log;
    UPDATE public.worker_daily_qr SET used_for_exit = true WHERE id = _q.id;
    RETURN jsonb_build_object('success', true, 'action', 'exit', 'log_id', _open_log,
      'worker_name', _q.name, 'company_name', COALESCE(_q.company_name,''));
  END IF;
END;
$$;

-- 5) RPC: 토큰으로 현재 상태 조회 (스캔 페이지에서 미리보기)
CREATE OR REPLACE FUNCTION public.get_daily_qr_status(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _q record;
BEGIN
  SELECT dq.id, dq.work_date, dq.expires_at, dq.used_for_entry, dq.used_for_exit,
         w.name, w.company_name, w.project_id
    INTO _q
    FROM public.worker_daily_qr dq
    JOIN public.workers w ON w.id = dq.worker_id
   WHERE dq.qr_token = _token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_TOKEN');
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'worker_name', _q.name,
    'company_name', COALESCE(_q.company_name,''),
    'work_date', _q.work_date,
    'expires_at', _q.expires_at,
    'used_for_entry', _q.used_for_entry,
    'used_for_exit', _q.used_for_exit,
    'expired', _q.expires_at < now()
  );
END;
$$;
