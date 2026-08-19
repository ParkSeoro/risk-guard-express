-- auth.refresh_tokens.user_id is varchar, not uuid.
-- retire_user_account → set_auth_login_blocked did DELETE ... WHERE user_id = _user_id
-- and raised: operator does not exist: character varying = uuid
-- (UI: 로그인 차단 실패). Sessions.user_id is already uuid.

CREATE OR REPLACE FUNCTION public.set_auth_login_blocked(_user_id uuid, _blocked boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;
  IF _blocked THEN
    BEGIN
      UPDATE auth.users SET banned_until = 'infinity'::timestamptz WHERE id = _user_id;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      NULL;
    END;
    BEGIN
      DELETE FROM auth.refresh_tokens WHERE user_id = _user_id::text;
    EXCEPTION WHEN undefined_table OR undefined_function THEN
      NULL;
    END;
    BEGIN
      DELETE FROM auth.sessions WHERE user_id = _user_id;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  ELSE
    BEGIN
      UPDATE auth.users SET banned_until = NULL WHERE id = _user_id;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      NULL;
    END;
  END IF;
END;
$body$;
