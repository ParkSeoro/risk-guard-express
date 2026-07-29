-- Admin security pledge flag for universal consent onboarding
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS agreed_to_admin_security boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.agreed_to_admin_security IS '관리자 개인정보 취급 및 보안 서약 동의';
