
-- Private config schema (service role only)
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.dispatch_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON private.dispatch_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.dispatch_config TO service_role;

-- Seed / upsert config values.
-- supabase_url is public (project URL). trigger_secret is a shared secret paired
-- with the PUSH_TRIGGER_SECRET env var on the edge function.
INSERT INTO private.dispatch_config(key, value) VALUES
  ('supabase_url',   'https://iqtiozscqwuacgzrlfzu.supabase.co'),
  ('trigger_secret', '07b47bf2d089c5a362567a90f354e9f88c1f9244ff41210c482612e94bb7d67a')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Rewrite dispatch trigger to read from private.dispatch_config
CREATE OR REPLACE FUNCTION public.trg_notifications_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _url    text;
  _secret text;
BEGIN
  SELECT value INTO _url    FROM private.dispatch_config WHERE key = 'supabase_url';
  SELECT value INTO _secret FROM private.dispatch_config WHERE key = 'trigger_secret';

  IF _url IS NULL OR _secret IS NULL OR _url = '' OR _secret = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := _url || '/functions/v1/dispatch-notification-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Push-Trigger-Secret', _secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'record', to_jsonb(NEW)
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_dispatch_push ON public.notifications;
CREATE TRIGGER trg_notifications_dispatch_push
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.trg_notifications_dispatch_push();
