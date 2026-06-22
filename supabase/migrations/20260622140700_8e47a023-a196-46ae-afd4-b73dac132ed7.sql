
CREATE TABLE IF NOT EXISTS public.worker_phone_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worker_phone_otps_phone ON public.worker_phone_otps(phone, created_at DESC);

GRANT ALL ON public.worker_phone_otps TO service_role;
-- 의도적으로 anon/authenticated 권한 없음. RPC(SECURITY DEFINER)로만 접근.

ALTER TABLE public.worker_phone_otps ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = 직접 접근 차단.

CREATE OR REPLACE FUNCTION public.request_worker_otp(_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _code text;
BEGIN
  IF _phone IS NULL OR length(trim(_phone)) < 8 THEN
    RETURN jsonb_build_object('error', 'INVALID_PHONE');
  END IF;
  -- 1분 내 재발급 차단
  IF EXISTS (
    SELECT 1 FROM public.worker_phone_otps
     WHERE phone = trim(_phone) AND created_at > now() - interval '1 minute'
  ) THEN
    RETURN jsonb_build_object('error', 'TOO_SOON');
  END IF;
  _code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO public.worker_phone_otps (phone, code, expires_at)
  VALUES (trim(_phone), _code, now() + interval '5 minutes');
  -- TODO: send-sms edge function 호출 (Twilio/AlignTalk 등 연동 시 추가)
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_worker_otp(_phone text, _code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _otp record; _w record;
BEGIN
  SELECT * INTO _otp FROM public.worker_phone_otps
   WHERE phone = trim(_phone) AND used = false
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF _otp.expires_at < now() THEN RETURN jsonb_build_object('error', 'EXPIRED'); END IF;
  IF _otp.attempts >= 5 THEN RETURN jsonb_build_object('error', 'TOO_MANY_ATTEMPTS'); END IF;
  UPDATE public.worker_phone_otps SET attempts = attempts + 1 WHERE id = _otp.id;
  IF _otp.code <> trim(_code) THEN RETURN jsonb_build_object('error', 'INVALID_CODE'); END IF;
  UPDATE public.worker_phone_otps SET used = true WHERE id = _otp.id;

  SELECT id, qr_token INTO _w FROM public.workers
   WHERE phone = trim(_phone) AND is_active = true
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'WORKER_NOT_REGISTERED'); END IF;
  RETURN jsonb_build_object('success', true, 'qr_token', _w.qr_token, 'worker_id', _w.id);
END;
$$;
