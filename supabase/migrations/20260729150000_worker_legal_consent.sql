-- Worker legal consent tracking (terms / location / privacy)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS agreed_to_terms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreed_to_location boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreed_to_privacy boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_agreed_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.agreed_to_terms IS '이용약관 동의';
COMMENT ON COLUMN public.profiles.agreed_to_location IS '위치정보 수집·이용 동의 (출퇴근·위험구역)';
COMMENT ON COLUMN public.profiles.agreed_to_privacy IS '개인정보 처리방침 동의';
COMMENT ON COLUMN public.profiles.consent_agreed_at IS '필수 약관 일괄 동의 시각';
