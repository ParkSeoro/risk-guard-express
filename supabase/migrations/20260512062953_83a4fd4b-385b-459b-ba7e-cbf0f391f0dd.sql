
-- 1. Drop legacy fn references first (still used by no policies)
DROP FUNCTION IF EXISTS public.get_project_role(uuid, uuid);

-- 2. user_roles cleanup + type conversion
DROP TRIGGER IF EXISTS trg_prevent_last_master_removal ON public.user_roles;
DROP TRIGGER IF EXISTS trg_prevent_last_master_update ON public.user_roles;

CREATE OR REPLACE FUNCTION public.prevent_last_master_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE master_count INT;
BEGIN
  IF OLD.role::text = 'master' THEN
    SELECT COUNT(*) INTO master_count FROM public.user_roles WHERE role::text = 'master' AND id != OLD.id;
    IF master_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last master role. At least one master must exist.';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_last_master_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE master_count INT;
BEGIN
  IF OLD.role::text = 'master' AND NEW.role::text != 'master' THEN
    SELECT COUNT(*) INTO master_count FROM public.user_roles WHERE role::text = 'master' AND id != OLD.id;
    IF master_count = 0 THEN
      RAISE EXCEPTION 'Cannot change the last master role. At least one master must exist.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DELETE FROM public.user_roles WHERE role::text <> 'master';
ALTER TABLE public.user_roles ALTER COLUMN role TYPE public.global_role USING role::text::public.global_role;

CREATE TRIGGER trg_prevent_last_master_removal BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_master_removal();
CREATE TRIGGER trg_prevent_last_master_update BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_master_update();

-- 3. handle_new_user / ensure_master_allowlist
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _email text;
  _master_emails text[] := ARRAY['seoro.park@dig-airgas.com'];
  _is_allowlisted boolean := false;
  user_count INT;
BEGIN
  _email := lower(trim(NEW.email));
  _is_allowlisted := (_email = ANY(_master_emails));

  INSERT INTO public.profiles (user_id, display_name, company, account_status)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
          COALESCE(NEW.raw_user_meta_data->>'company',''),
          CASE WHEN _is_allowlisted THEN 'active' ELSE 'pending' END);

  IF _is_allowlisted THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'master'::public.global_role)
      ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    SELECT COUNT(*) INTO user_count FROM public.user_roles;
    IF user_count = 0 THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'master'::public.global_role);
      UPDATE public.profiles SET account_status = 'active' WHERE user_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_master_allowlist(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _email text;
  _master_emails text[] := ARRAY['seoro.park@dig-airgas.com'];
BEGIN
  SELECT lower(trim(email)) INTO _email FROM auth.users WHERE id = _user_id;
  IF _email = ANY(_master_emails) THEN
    UPDATE public.profiles SET account_status = 'active', updated_at = now()
     WHERE user_id = _user_id AND account_status != 'active';
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'master'::public.global_role)
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;

-- 4. project_invites.default_role → project_role
ALTER TABLE public.project_invites ALTER COLUMN default_role DROP DEFAULT;
ALTER TABLE public.project_invites ALTER COLUMN default_role TYPE public.project_role
  USING (CASE
    WHEN default_role::text IN ('project_admin','safety_manager','site_manager','supervisor','worker','viewer')
      THEN default_role::text::public.project_role
    ELSE 'site_manager'::public.project_role  -- contractor → site_manager
  END);
ALTER TABLE public.project_invites ALTER COLUMN default_role SET DEFAULT 'viewer'::public.project_role;

-- 5. project_join_requests.requested_role → project_role
ALTER TABLE public.project_join_requests ALTER COLUMN requested_role DROP DEFAULT;
ALTER TABLE public.project_join_requests ALTER COLUMN requested_role TYPE public.project_role
  USING (CASE
    WHEN requested_role::text IN ('project_admin','safety_manager','site_manager','supervisor','worker','viewer')
      THEN requested_role::text::public.project_role
    ELSE 'viewer'::public.project_role
  END);
ALTER TABLE public.project_join_requests ALTER COLUMN requested_role SET DEFAULT 'viewer'::public.project_role;

-- 6. process_invite_code → uses role_new only
CREATE OR REPLACE FUNCTION public.process_invite_code(_user_id uuid, _invite_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _invite record; _company record;
BEGIN
  SELECT * INTO _invite FROM public.project_invites WHERE code = _invite_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','INVALID_CODE'); END IF;
  IF _invite.expires_at IS NOT NULL AND _invite.expires_at < now() THEN
    RETURN jsonb_build_object('error','EXPIRED'); END IF;
  IF _invite.max_uses > 0 AND _invite.use_count >= _invite.max_uses THEN
    RETURN jsonb_build_object('error','MAX_USES_EXCEEDED'); END IF;

  IF _invite.company_id IS NOT NULL THEN
    SELECT * INTO _company FROM public.companies WHERE id = _invite.company_id;
  END IF;

  INSERT INTO public.project_members (project_id, user_id, role_new, company_id, company)
  VALUES (_invite.project_id, _user_id, _invite.default_role, _invite.company_id, COALESCE(_company.name,''))
  ON CONFLICT DO NOTHING;

  UPDATE public.profiles SET account_status = 'active'
   WHERE user_id = _user_id AND account_status = 'pending';
  UPDATE public.project_invites SET use_count = COALESCE(use_count,0)+1 WHERE id = _invite.id;

  RETURN jsonb_build_object(
    'success', true,
    'project_id', _invite.project_id,
    'role', _invite.default_role,
    'company_name', COALESCE(_company.name,''),
    'company_id', _invite.company_id
  );
END;
$$;

-- 7. project_members: promote role_new to NOT NULL, drop legacy columns
UPDATE public.project_members SET role_new = 'viewer'::public.project_role WHERE role_new IS NULL;
ALTER TABLE public.project_members ALTER COLUMN role_new SET NOT NULL;
ALTER TABLE public.project_members ALTER COLUMN role_new SET DEFAULT 'viewer'::public.project_role;
ALTER TABLE public.project_members DROP COLUMN role;
ALTER TABLE public.project_members DROP COLUMN position;

-- 8. Drop has_role(uuid, app_role)
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);

-- 9. Finally drop the enum
DROP TYPE IF EXISTS public.app_role;
