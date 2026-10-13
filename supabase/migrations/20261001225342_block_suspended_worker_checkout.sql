DO $do$
DECLARE
  def text;
  old text := $old$IF _action = 'entry' THEN
    IF _w.site_entry_suspended_until IS NOT NULL AND _w.site_entry_suspended_until > now() THEN
      RETURN jsonb_build_object(
        'error', 'SUSPENDED',
        'until', _w.site_entry_suspended_until,
        'reason', _w.site_entry_suspension_reason
      );
    END IF;$old$;
  new text := $new$IF _action IN ('entry', 'exit')
     AND _w.site_entry_suspended_until IS NOT NULL
     AND _w.site_entry_suspended_until > now() THEN
    RETURN jsonb_build_object(
      'error', 'SUSPENDED',
      'until', _w.site_entry_suspended_until,
      'reason', _w.site_entry_suspension_reason
    );
  END IF;

  IF _action = 'entry' THEN$new$;
BEGIN
  def := pg_get_functiondef('public.worker_gps_daily_lifecycle(text,uuid,uuid,double precision,double precision,double precision,text,uuid,text)'::regprocedure);
  IF strpos(def, old) = 0 THEN
    RAISE EXCEPTION 'lifecycle pattern missing';
  END IF;
  EXECUTE replace(def, old, new);
END
$do$;
