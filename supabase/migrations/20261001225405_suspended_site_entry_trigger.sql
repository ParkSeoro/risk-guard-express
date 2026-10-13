CREATE OR REPLACE FUNCTION public.attendance_spot_name(_project_id uuid, _lat float8, _lng float8, _accuracy_m float8)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s record; has_spots boolean := false;
  b_name text; b_type text; b_poly jsonb; b_lat float8; b_lng float8; b_radius float8; b_buffer float8;
  pin_lat float8; pin_lng float8; acc float8 := greatest(COALESCE(_accuracy_m, 0), 0); d float8;
BEGIN
  IF _project_id IS NULL OR _lat IS NULL OR _lng IS NULL THEN RETURN NULL; END IF;
  FOR s IN
    SELECT name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, buffer_m
      FROM public.project_site_spots
     WHERE project_id = _project_id AND is_deleted = false AND is_active = true
     ORDER BY sort_order, created_at
  LOOP
    has_spots := true;
    IF public.point_within_attendance(_lat, _lng, s.geometry_type, s.geo_polygon, s.center_lat, s.center_lng, s.radius_m, s.buffer_m, _accuracy_m) THEN
      RETURN COALESCE(NULLIF(btrim(s.name), ''), '현장');
    END IF;
  END LOOP;
  IF has_spots THEN RETURN NULL; END IF;
  SELECT b.name, b.geometry_type, b.geo_polygon, b.center_lat, b.center_lng, b.radius_m, b.buffer_m
    INTO b_name, b_type, b_poly, b_lat, b_lng, b_radius, b_buffer
    FROM public.project_site_boundaries b
   WHERE b.project_id = _project_id AND b.is_deleted = false AND b.is_active = true
   LIMIT 1;
  IF FOUND AND public.point_within_attendance(_lat, _lng, b_type, b_poly, b_lat, b_lng, b_radius, b_buffer, _accuracy_m) THEN
    RETURN COALESCE(NULLIF(btrim(b_name), ''), '현장');
  END IF;
  SELECT site_lat, site_lng INTO pin_lat, pin_lng FROM public.projects WHERE id = _project_id;
  IF pin_lat IS NOT NULL AND pin_lng IS NOT NULL THEN
    d := public.geo_haversine_m(_lat, _lng, pin_lat, pin_lng);
    IF d <= 350 + least(acc, 80) THEN RETURN '현장'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_spot_name(uuid, float8, float8, float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_spot_name(uuid, float8, float8, float8) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_worker_position_suspended_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _spot text; _watch boolean;
BEGIN
  SELECT (w.site_entry_suspended_until IS NOT NULL AND w.site_entry_suspended_until > now())
      OR EXISTS (SELECT 1 FROM public.worker_suspension_site_presence p WHERE p.worker_id = NEW.worker_id AND p.project_id = NEW.project_id AND p.inside)
    INTO _watch FROM public.workers w WHERE w.id = NEW.worker_id;
  IF NOT COALESCE(_watch, false) THEN RETURN NEW; END IF;
  _spot := public.attendance_spot_name(NEW.project_id, NEW.lat, NEW.lng, NEW.accuracy_m);
  PERFORM public.notify_suspended_site_entry(NEW.project_id, NEW.worker_id, _spot IS NOT NULL, _spot);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'suspended site entry alarm skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_worker_position_suspended_entry ON public.worker_last_positions;
CREATE TRIGGER trg_worker_position_suspended_entry
  AFTER INSERT OR UPDATE OF lat, lng, accuracy_m, project_id
  ON public.worker_last_positions
  FOR EACH ROW EXECUTE FUNCTION public.trg_worker_position_suspended_entry();

CREATE OR REPLACE FUNCTION public.should_push_notify(_user_id uuid, _type text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p record; _is_mandatory boolean; _now_t time := (now() AT TIME ZONE 'Asia/Seoul')::time;
BEGIN
  _is_mandatory := _type IN ('incident','approval_request','approval_result','critical_alert','danger_zone_entry','suspended_site_entry','emergency_drill','work_stop','announcement','assessment_share');
  SELECT * INTO p FROM public.notification_preferences WHERE user_id = _user_id;
  IF p IS NULL THEN RETURN true; END IF;
  IF NOT _is_mandatory AND COALESCE(p.channel_push, true) = false THEN RETURN false; END IF;
  IF NOT _is_mandatory AND p.push_quiet_start IS NOT NULL AND p.push_quiet_end IS NOT NULL THEN
    IF p.push_quiet_start < p.push_quiet_end THEN
      IF _now_t >= p.push_quiet_start AND _now_t < p.push_quiet_end THEN RETURN false; END IF;
    ELSE
      IF _now_t >= p.push_quiet_start OR _now_t < p.push_quiet_end THEN RETURN false; END IF;
    END IF;
  END IF;
  RETURN CASE _type
    WHEN 'approval_request' THEN true
    WHEN 'approval_result' THEN true
    WHEN 'danger_zone_entry' THEN true
    WHEN 'suspended_site_entry' THEN true
    WHEN 'announcement' THEN true
    WHEN 'assessment_share' THEN true
    WHEN 'return_request' THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection' THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit' THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm' THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning' THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due' THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident' THEN true
    WHEN 'todo_due' THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result' THEN COALESCE(p.event_assessment_result, true)
    ELSE COALESCE(p.event_general, true)
  END;
END; $function$;
