-- Allow masters / project admins to read auth emails for user-management UI.
-- auth.users is not directly selectable from the client.

CREATE OR REPLACE FUNCTION public.list_manageable_user_auth_info()
RETURNS TABLE (
  out_user_id uuid,
  out_email text,
  out_last_sign_in_at timestamptz,
  out_email_confirmed_at timestamptz,
  out_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
        AND pm.role_new = 'project_admin'
    )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS out_user_id,
    COALESCE(u.email, '')::text AS out_email,
    u.last_sign_in_at AS out_last_sign_in_at,
    u.email_confirmed_at AS out_email_confirmed_at,
    u.created_at AS out_created_at
  FROM auth.users u;
END;
$$;

REVOKE ALL ON FUNCTION public.list_manageable_user_auth_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_manageable_user_auth_info() TO authenticated;

COMMENT ON FUNCTION public.list_manageable_user_auth_info() IS
  'Master/project_admin only: auth email + last sign-in for user management UI.';
