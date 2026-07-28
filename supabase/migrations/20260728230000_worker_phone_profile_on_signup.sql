-- Persist phone from worker signup metadata onto profiles.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
  _master_emails text[] := ARRAY['seoro.park@dig-airgas.com'];
  _is_allowlisted boolean := false;
  user_count INT;
  _phone text;
BEGIN
  _email := lower(trim(NEW.email));
  _is_allowlisted := (_email = ANY(_master_emails));
  _phone := NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'phone', ''), '\D', '', 'g'), '');

  INSERT INTO public.profiles (user_id, display_name, company, phone, account_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'company', ''),
    _phone,
    CASE WHEN _is_allowlisted THEN 'active' ELSE 'pending' END
  );

  IF _is_allowlisted THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'master'::public.global_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    SELECT COUNT(*) INTO user_count FROM public.user_roles;
    IF user_count = 0 THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'master'::public.global_role);
      UPDATE public.profiles SET account_status = 'active' WHERE user_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
