-- Service-role-only reader for the Gemini authorization key stored in Vault.
-- Authenticated and anon clients cannot execute this. Other secret names return null.

CREATE OR REPLACE FUNCTION public.get_runtime_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public, pg_temp
AS $$
DECLARE
  jwt_role text;
  result text;
BEGIN
  jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.role(), ''),
    ''
  );

  IF jwt_role = 'service_role' THEN
    NULL;
  ELSIF jwt_role <> '' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  ELSIF session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF secret_name IS DISTINCT FROM 'GEMINI_API_KEY' THEN
    RETURN NULL;
  END IF;

  SELECT ds.decrypted_secret
    INTO result
  FROM vault.decrypted_secrets ds
  WHERE ds.name = secret_name
  ORDER BY ds.updated_at DESC NULLS LAST
  LIMIT 1;

  RETURN nullif(btrim(result), '');
END;
$$;

REVOKE ALL ON FUNCTION public.get_runtime_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_runtime_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_runtime_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_runtime_secret(text) TO service_role;

COMMENT ON FUNCTION public.get_runtime_secret(text) IS
  'Returns the GEMINI_API_KEY vault secret to service_role only. Other names return null.';
