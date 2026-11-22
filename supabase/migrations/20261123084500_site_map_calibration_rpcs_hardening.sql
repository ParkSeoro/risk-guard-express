-- PR 2 hardening:
-- 1) Tighten `can_calibrate_site_map` to an explicit client/GC company-type allowlist
--    (fail-closed on NULL company_id, contractor, vendor, subcontractor, 하청, 납품사)
--    and REVOKE authenticated EXECUTE on the internal helper so other users' UUIDs cannot be probed.
-- 2) Validate `save_project_gps_calibration` JSON offset magnitude <= 260m server-side.

CREATE OR REPLACE FUNCTION public.can_calibrate_site_map(_uid uuid, _project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _uid IS NULL OR _project_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_master(_uid) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.project_members pm
      JOIN public.companies c ON c.id = pm.company_id
     WHERE pm.user_id = _uid
       AND pm.project_id = _project_id
       AND pm.role_new::text IN ('master', 'project_admin', 'safety_manager')
       AND lower(btrim(COALESCE(c.type, ''))) IN ('client', 'owner', 'gc', '발주처', '시공사', '원청')
  );
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
  _d_lat double precision;
  _d_lng double precision;
  _map_lat double precision;
  _offset_m double precision;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.can_calibrate_site_map(_uid, _project_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF _calibration IS NOT NULL THEN
    IF jsonb_typeof(_calibration) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_GPS_CALIBRATION';
    END IF;
    _d_lat := (_calibration->>'d_lat')::double precision;
    _d_lng := (_calibration->>'d_lng')::double precision;
    _map_lat := COALESCE(NULLIF(_calibration->>'map_lat', '')::double precision, 37.0);
    IF _d_lat IS NULL OR _d_lng IS NULL OR abs(_map_lat) > 90 THEN
      RAISE EXCEPTION 'INVALID_GPS_CALIBRATION';
    END IF;
    _offset_m := sqrt(
      power(_d_lat * 111320.0, 2) +
      power(_d_lng * 111320.0 * cos(radians(_map_lat)), 2)
    );
    IF _offset_m > 260.0 THEN
      RAISE EXCEPTION 'GPS_CALIBRATION_OFFSET_TOO_LARGE';
    END IF;
  END IF;

  UPDATE public.projects
     SET gps_calibration = _calibration
   WHERE id = _project_id;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', _project_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.can_calibrate_site_map(uuid, uuid) FROM PUBLIC, anon, authenticated;
