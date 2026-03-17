
-- Add company_id to project_invites
ALTER TABLE public.project_invites ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- Create function to process invite code after signup
CREATE OR REPLACE FUNCTION public.process_invite_code(_user_id uuid, _invite_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invite record;
  _company record;
  _result jsonb;
BEGIN
  -- Look up invite
  SELECT * INTO _invite FROM public.project_invites WHERE code = _invite_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_CODE');
  END IF;

  -- Check expiry
  IF _invite.expires_at IS NOT NULL AND _invite.expires_at < now() THEN
    RETURN jsonb_build_object('error', 'EXPIRED');
  END IF;

  -- Check max uses
  IF _invite.max_uses > 0 AND _invite.use_count >= _invite.max_uses THEN
    RETURN jsonb_build_object('error', 'MAX_USES_EXCEEDED');
  END IF;

  -- Get company info if set
  IF _invite.company_id IS NOT NULL THEN
    SELECT * INTO _company FROM public.companies WHERE id = _invite.company_id;
  END IF;

  -- Insert project member (ignore duplicate)
  INSERT INTO public.project_members (project_id, user_id, role, company_id, company)
  VALUES (
    _invite.project_id,
    _user_id,
    _invite.default_role,
    _invite.company_id,
    COALESCE(_company.name, '')
  )
  ON CONFLICT DO NOTHING;

  -- Activate profile
  UPDATE public.profiles SET account_status = 'active' WHERE user_id = _user_id AND account_status = 'pending';

  -- Increment use count
  UPDATE public.project_invites SET use_count = COALESCE(use_count, 0) + 1 WHERE id = _invite.id;

  RETURN jsonb_build_object(
    'success', true,
    'project_id', _invite.project_id,
    'role', _invite.default_role,
    'company_name', COALESCE(_company.name, ''),
    'company_id', _invite.company_id
  );
END;
$$;
