CREATE OR REPLACE FUNCTION public.labor_night_minutes(_entry timestamptz, _exit timestamptz)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v_day date; v_end date; v_total numeric := 0; v_ws timestamptz; v_we timestamptz;
BEGIN
  IF _entry IS NULL OR _exit IS NULL OR _exit <= _entry THEN RETURN 0; END IF;
  v_day := (_entry AT TIME ZONE 'Asia/Seoul')::date;
  v_end := (_exit AT TIME ZONE 'Asia/Seoul')::date;
  WHILE v_day <= v_end LOOP
    v_ws := (v_day::timestamp AT TIME ZONE 'Asia/Seoul');
    v_we := ((v_day::timestamp + interval '6 hours') AT TIME ZONE 'Asia/Seoul');
    v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(_exit, v_we) - GREATEST(_entry, v_ws))));
    v_ws := ((v_day::timestamp + interval '22 hours') AT TIME ZONE 'Asia/Seoul');
    v_we := (((v_day + 1)::timestamp) AT TIME ZONE 'Asia/Seoul');
    v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(_exit, v_we) - GREATEST(_entry, v_ws))));
    v_day := v_day + 1;
  END LOOP;
  RETURN FLOOR(v_total / 60.0)::integer;
END;$$;

CREATE OR REPLACE FUNCTION public.labor_week_start(_day date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT _day - ((EXTRACT(ISODOW FROM _day)::integer) - 1);
$$;

CREATE OR REPLACE FUNCTION public.labor_assert_project_read(_project_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _project_id IS NULL THEN RAISE EXCEPTION 'project_required'; END IF;
  IF NOT (public.is_master(v_uid) OR public.is_project_member(v_uid, _project_id)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN v_uid;
END;$$;

REVOKE ALL ON FUNCTION public.labor_night_minutes(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.labor_week_start(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.labor_assert_project_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labor_night_minutes(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labor_week_start(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labor_assert_project_read(uuid) TO authenticated, service_role;
