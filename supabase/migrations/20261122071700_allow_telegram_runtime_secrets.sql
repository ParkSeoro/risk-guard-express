-- Allow service_role to read TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from Supabase Vault
-- via get_runtime_secret() for the daily 07:00 KST overnight Telegram briefing.

CREATE OR REPLACE FUNCTION public.get_runtime_secret(secret_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'vault', 'public', 'pg_temp'
AS $function$
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

  IF secret_name NOT IN (
    'GEMINI_API_KEY',
    'GDRIVE_CLIENT_ID',
    'GDRIVE_CLIENT_SECRET',
    'GDRIVE_REFRESH_TOKEN',
    'BACKUP_TRIGGER_SECRET',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID'
  ) THEN
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
$function$;
