-- Lookup auth.users by email for worker account provisioning (service_role only).
CREATE OR REPLACE FUNCTION public.lookup_auth_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'auth', 'public'
AS $$
  SELECT id
    FROM auth.users
   WHERE lower(email) = lower(trim(_email))
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_auth_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_auth_user_id_by_email(text) TO service_role;
