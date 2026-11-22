-- PR 2: Least-privilege SECURITY DEFINER RPCs for site map georeferencing and
-- project GPS calibration so `master` + non-contractor `project_admin` + `safety_manager`
-- can perform mobile walking calibration without widening direct table UPDATE RLS.

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
      LEFT JOIN public.companies c ON c.id = pm.company_id
     WHERE pm.user_id = _uid
       AND pm.project_id = _project_id
       AND pm.role_new::text IN ('master', 'project_admin', 'safety_manager')
       AND COALESCE(lower(c.type), '') NOT IN ('contractor', 'vendor', '협력사', '공급사')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_site_map_georef(
  _site_map_id uuid,
  _geo_transform jsonb,
  _nw_lat double precision,
  _nw_lng double precision,
  _se_lat double precision,
  _se_lng double precision,
  _clear_gps_calibration boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _project_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT sm.project_id
    INTO _project_id
    FROM public.site_maps sm
   WHERE sm.id = _site_map_id
     AND COALESCE(sm.is_deleted, false) = false;

  IF _project_id IS NULL THEN
    RAISE EXCEPTION 'SITE_MAP_NOT_FOUND';
  END IF;

  IF NOT public.can_calibrate_site_map(_uid, _project_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF _nw_lat IS NULL OR _nw_lng IS NULL OR _se_lat IS NULL OR _se_lng IS NULL
     OR abs(_nw_lat) > 90 OR abs(_se_lat) > 90
     OR abs(_nw_lng) > 180 OR abs(_se_lng) > 180 THEN
    RAISE EXCEPTION 'INVALID_WGS84_BOUNDS';
  END IF;

  UPDATE public.site_maps
     SET geo_transform = _geo_transform,
         geo_anchor_nw_lat = _nw_lat,
         geo_anchor_nw_lng = _nw_lng,
         geo_anchor_se_lat = _se_lat,
         geo_anchor_se_lng = _se_lng,
         updated_at = now()
   WHERE id = _site_map_id;

  IF COALESCE(_clear_gps_calibration, true) THEN
    UPDATE public.projects
       SET gps_calibration = NULL
     WHERE id = _project_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'site_map_id', _site_map_id,
    'project_id', _project_id
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
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.can_calibrate_site_map(_uid, _project_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
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

REVOKE ALL ON FUNCTION public.can_calibrate_site_map(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_calibrate_site_map(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.save_site_map_georef(uuid, jsonb, double precision, double precision, double precision, double precision, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_site_map_georef(uuid, jsonb, double precision, double precision, double precision, double precision, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.save_project_gps_calibration(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_project_gps_calibration(uuid, jsonb) TO authenticated;
