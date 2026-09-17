-- One HTTP per INSERT statement instead of one HTTP per notification row.
-- Site-wide announcements insert hundreds of rows in one statement; FOR EACH ROW
-- used to fire pg_net that many times and melt the API.

CREATE OR REPLACE FUNCTION public.trg_notifications_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _url    text;
  _secret text;
  _ids    jsonb;
BEGIN
  SELECT value INTO _url    FROM private.dispatch_config WHERE key = 'supabase_url';
  SELECT value INTO _secret FROM private.dispatch_config WHERE key = 'trigger_secret';

  IF _url IS NULL OR _secret IS NULL OR _url = '' OR _secret = '' THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO _ids FROM new_rows;
  IF _ids = '[]'::jsonb THEN
    RETURN NULL;
  END IF;

  PERFORM net.http_post(
    url := _url || '/functions/v1/dispatch-notification-push',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'notification_ids', _ids
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Push-Trigger-Secret', _secret
    ),
    timeout_milliseconds := 120000
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notifications_dispatch_push ON public.notifications;
CREATE TRIGGER trg_notifications_dispatch_push
  AFTER INSERT ON public.notifications
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_notifications_dispatch_push();
