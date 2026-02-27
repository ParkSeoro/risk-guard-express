
-- 1) Function: ensure allowlist master (seoro.park@dig-airgas.com)
-- Called on login to enforce permanent master status
CREATE OR REPLACE FUNCTION public.ensure_master_allowlist(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _email text;
  _master_emails text[] := ARRAY['seoro.park@dig-airgas.com'];
BEGIN
  -- Get email from auth.users
  SELECT lower(trim(email)) INTO _email FROM auth.users WHERE id = _user_id;
  
  IF _email = ANY(_master_emails) THEN
    -- Ensure profile is active
    UPDATE public.profiles 
    SET account_status = 'active', updated_at = now()
    WHERE user_id = _user_id AND account_status != 'active';
    
    -- Ensure master role exists
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'master')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;

-- 2) Update handle_new_user to check allowlist FIRST, then bootstrap
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _email text;
  _master_emails text[] := ARRAY['seoro.park@dig-airgas.com'];
  _is_allowlisted boolean := false;
  user_count INT;
BEGIN
  _email := lower(trim(NEW.email));
  _is_allowlisted := (_email = ANY(_master_emails));

  -- Create profile with appropriate status
  INSERT INTO public.profiles (user_id, display_name, company, account_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'company', ''),
    CASE WHEN _is_allowlisted THEN 'active' ELSE 'pending' END
  );
  
  IF _is_allowlisted THEN
    -- Allowlist user always gets master
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'master')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    -- First-user bootstrap: if no active roles exist, make first user master+active
    SELECT COUNT(*) INTO user_count FROM public.user_roles;
    IF user_count = 0 THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'master');
      UPDATE public.profiles SET account_status = 'active' WHERE user_id = NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 3) Prevent removing the last master role
CREATE OR REPLACE FUNCTION public.prevent_last_master_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  master_count INT;
BEGIN
  IF OLD.role = 'master' THEN
    SELECT COUNT(*) INTO master_count 
    FROM public.user_roles 
    WHERE role = 'master' AND id != OLD.id;
    
    IF master_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last master role. At least one master must exist.';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_master_removal ON public.user_roles;
CREATE TRIGGER trg_prevent_last_master_removal
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_master_removal();

-- Also prevent UPDATE that changes role away from master if it's the last one
CREATE OR REPLACE FUNCTION public.prevent_last_master_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  master_count INT;
BEGIN
  IF OLD.role = 'master' AND NEW.role != 'master' THEN
    SELECT COUNT(*) INTO master_count 
    FROM public.user_roles 
    WHERE role = 'master' AND id != OLD.id;
    
    IF master_count = 0 THEN
      RAISE EXCEPTION 'Cannot change the last master role. At least one master must exist.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_master_update ON public.user_roles;
CREATE TRIGGER trg_prevent_last_master_update
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_master_update();

-- 4) Migrate existing data: if seoro.park@dig-airgas.com already exists, enforce master+active
DO $$
DECLARE
  _uid uuid;
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE lower(trim(email)) = 'seoro.park@dig-airgas.com' LIMIT 1;
  IF _uid IS NOT NULL THEN
    UPDATE public.profiles SET account_status = 'active', updated_at = now() WHERE user_id = _uid;
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'master') ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;
