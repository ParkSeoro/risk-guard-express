-- PR 2 final hardening:
-- 1) Guard direct `projects.gps_calibration` UPDATEs with a BEFORE UPDATE trigger so
--    contractor safety_managers cannot bypass `save_project_gps_calibration`, while
--    leaving all other `projects` column updates completely untouched.
-- 2) Clamp `abs(map_lat)` to <= 45° when validating the 260m offset cap so a crafted
--    `map_lat: 89` cannot shrink `cos(lat)` and smuggle a multi-kilometer `d_lng`.

CREATE OR REPLACE FUNCTION public.validate_gps_calibration_jsonb(_calibration jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _d_lat double precision;
  _d_lng double precision;
  _map_lat double precision;
  _offset_m double precision;
BEGIN
  IF _calibration IS NULL THEN
    RETURN;
  END IF;

  IF jsonb_typeof(_calibration) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_GPS_CALIBRATION';
  END IF;

  _d_lat := (_calibration->>'d_lat')::double precision;
  _d_lng := (_calibration->>'d_lng')::double precision;
  _map_lat := COALESCE(NULLIF(_calibration->>'map_lat', '')::double precision, 37.0);

  IF _d_lat IS NULL OR _d_lng IS NULL OR abs(_map_lat) > 90 THEN
    RAISE EXCEPTION 'INVALID_GPS_CALIBRATION';
  END IF;

  -- Clamp latitude at 45° so cos(lat) cannot be shrunk near the poles to bypass the 260m cap.
  _offset_m := sqrt(
    power(_d_lat * 111320.0, 2) +
    power(_d_lng * 111320.0 * cos(radians(LEAST(abs(_map_lat), 45.0))), 2)
  );

  IF _offset_m > 260.0 THEN
    RAISE EXCEPTION 'GPS_CALIBRATION_OFFSET_TOO_LARGE';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_project_gps_calibration(
  _project_id uuid,
  _calibration jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.can_calibrate_site_map(_uid, _project_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  PERFORM public.validate_gps_calibration_jsonb(_calibration);

  UPDATE public.projects
     SET gps_calibration = _calibration
   WHERE id = _project_id;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', _project_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_projects_gps_calibration_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
BEGIN
  IF NEW.gps_calibration IS NOT DISTINCT FROM OLD.gps_calibration THEN
    RETURN NEW;
  END IF;

  IF _uid IS NOT NULL AND NOT public.can_calibrate_site_map(_uid, NEW.id) THEN
    RAISE EXCEPTION 'FORBIDDEN'
      USING ERRCODE = '42501', HINT = '현장 GPS 보정 권한이 없습니다.';
  END IF;

  PERFORM public.validate_gps_calibration_jsonb(NEW.gps_calibration);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER trg_projects_gps_calibration_guard
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_projects_gps_calibration_update();

REVOKE ALL ON FUNCTION public.validate_gps_calibration_jsonb(jsonb) FROM PUBLIC, anon, authenticated;
