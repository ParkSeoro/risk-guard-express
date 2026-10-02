-- Suspended workers must not clock in or out. If their phone is still
-- inside the site (no attendance row required), tell that company's managers
-- and every ancestor company once per visit.

CREATE TABLE IF NOT EXISTS public.worker_suspension_site_presence (
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  inside boolean NOT NULL DEFAULT false,
  spot_name text,
  last_alert_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (worker_id, project_id)
);

ALTER TABLE public.worker_suspension_site_presence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.worker_suspension_site_presence FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.worker_suspension_site_presence TO service_role;

COMMENT ON TABLE public.worker_suspension_site_presence IS
  'Last on-site state for a suspended worker. One alarm per entry; leaving clears it.';

CREATE OR REPLACE FUNCTION public.notify_suspended_site_entry(
  _project_id uuid,
  _worker_id uuid,
  _inside boolean,
  _spot_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _w record;
  _suspended boolean;
  _was_inside boolean;
  _kind text;
  _company_name text;
  _title text;
  _message text;
  _link text := '/app/admin/workers';
  _n int := 0;
  _added int;
  _cid uuid;
BEGIN
  IF _project_id IS NULL OR _worker_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'alerted', false);
  END IF;

  SELECT w.company_id,
         w.name,
         w.site_entry_suspended_until,
         w.site_entry_suspension_reason,
         w.site_entry_suspension_kind,
         c.name AS company_name
    INTO _w
    FROM public.workers w
    LEFT JOIN public.companies c ON c.id = w.company_id
   WHERE w.id = _worker_id
     AND w.project_id = _project_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'alerted', false);
  END IF;

  _suspended := _w.site_entry_suspended_until IS NOT NULL
    AND _w.site_entry_suspended_until > now();

  SELECT p.inside INTO _was_inside
    FROM public.worker_suspension_site_presence p
   WHERE p.worker_id = _worker_id
     AND p.project_id = _project_id;

  IF NOT _suspended OR NOT COALESCE(_inside, false) THEN
    INSERT INTO public.worker_suspension_site_presence
      (worker_id, project_id, inside, spot_name, updated_at)
    VALUES (_worker_id, _project_id, false, NULL, now())
    ON CONFLICT (worker_id, project_id)
    DO UPDATE SET inside = false, spot_name = NULL, updated_at = now();
    RETURN jsonb_build_object(
      'ok', true, 'alerted', false, 'suspended', _suspended, 'inside', false
    );
  END IF;

  IF COALESCE(_was_inside, false) THEN
    UPDATE public.worker_suspension_site_presence
       SET spot_name = COALESCE(NULLIF(btrim(COALESCE(_spot_name, '')), ''), spot_name),
           updated_at = now()
     WHERE worker_id = _worker_id
       AND project_id = _project_id;
    RETURN jsonb_build_object(
      'ok', true, 'alerted', false, 'suspended', true, 'inside', true, 'repeat', true
    );
  END IF;

  _kind := CASE _w.site_entry_suspension_kind
    WHEN '1d' THEN '1일'
    WHEN '3d' THEN '3일'
    WHEN 'permanent' THEN '영구'
    ELSE '출입'
  END;
  _company_name := COALESCE(NULLIF(btrim(_w.company_name), ''), '소속 업체');
  _title := '출입 정지 근로자 현장 진입';
  _message := format(
    '%s (%s) · %s 정지%s%s',
    COALESCE(NULLIF(btrim(_w.name), ''), '근로자'),
    _company_name,
    _kind,
    CASE
      WHEN _w.site_entry_suspension_reason IS NOT NULL
       AND btrim(_w.site_entry_suspension_reason) <> ''
      THEN ' · ' || btrim(_w.site_entry_suspension_reason)
      ELSE ''
    END,
    CASE
      WHEN _spot_name IS NOT NULL AND btrim(_spot_name) <> ''
      THEN ' · ' || btrim(_spot_name)
      ELSE ''
    END
  );

  IF _w.company_id IS NULL THEN
    _n := public.notify_project_roles(
      _project_id,
      ARRAY['project_admin']::text[],
      _title,
      _message,
      'suspended_site_entry',
      _link,
      NULL,
      NULL,
      'worker',
      _worker_id::text,
      'high',
      ARRAY['OWNER_PM', 'OWNER_CM']::text[]
    );
  ELSE
    FOR _cid IN
      WITH RECURSIVE ancestors AS (
        SELECT c.id,
               COALESCE(pc.parent_company_id, c.parent_company_id) AS parent_id,
               0 AS depth
          FROM public.companies c
          LEFT JOIN public.project_companies pc
            ON pc.company_id = c.id
           AND pc.project_id = _project_id
           AND COALESCE(pc.is_deleted, false) = false
         WHERE c.id = _w.company_id
           AND COALESCE(c.is_deleted, false) = false
        UNION ALL
        SELECT c.id,
               COALESCE(pc.parent_company_id, c.parent_company_id),
               a.depth + 1
          FROM ancestors a
          JOIN public.companies c ON c.id = a.parent_id
          LEFT JOIN public.project_companies pc
            ON pc.company_id = c.id
           AND pc.project_id = _project_id
           AND COALESCE(pc.is_deleted, false) = false
         WHERE a.parent_id IS NOT NULL
           AND COALESCE(c.is_deleted, false) = false
           AND a.depth < 8
      )
      SELECT a.id FROM ancestors a
    LOOP
      _added := public.notify_project_roles(
        _project_id,
        ARRAY['safety_manager', 'site_manager', 'site_supervisor', 'project_admin']::text[],
        _title,
        _message,
        'suspended_site_entry',
        _link,
        _cid,
        NULL,
        'worker',
        _worker_id::text,
        'high',
        ARRAY[
          'SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'OWNER_SM',
          'SITE_SUPERVISOR', 'SUPERVISOR', 'OWNER_PM', 'OWNER_CM'
        ]::text[]
      );
      _n := _n + COALESCE(_added, 0);
    END LOOP;
  END IF;

  INSERT INTO public.worker_suspension_site_presence
    (worker_id, project_id, inside, spot_name, last_alert_at, updated_at)
  VALUES (_worker_id, _project_id, true, NULLIF(btrim(COALESCE(_spot_name, '')), ''), now(), now())
  ON CONFLICT (worker_id, project_id)
  DO UPDATE SET inside = true,
                spot_name = EXCLUDED.spot_name,
                last_alert_at = now(),
                updated_at = now();

  RETURN jsonb_build_object(
    'ok', true, 'alerted', true, 'notified', _n, 'suspended', true, 'inside', true
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.notify_suspended_site_entry(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_suspended_site_entry(uuid, uuid, boolean, text)
  TO service_role;

COMMENT ON FUNCTION public.notify_suspended_site_entry(uuid, uuid, boolean, text) IS
  'Service role. Suspended worker inside the site → one alarm to company managers and ancestor companies.';

-- Same mandatory siren path as danger-zone entry. Quiet hours cannot mute it.
CREATE OR REPLACE FUNCTION public.should_push_notify(_user_id uuid, _type text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record;
  _is_mandatory boolean;
  _now_t time := (now() AT TIME ZONE 'Asia/Seoul')::time;
BEGIN
  _is_mandatory := _type IN (
    'incident','approval_request','approval_result','critical_alert',
    'danger_zone_entry','suspended_site_entry','emergency_drill','work_stop','announcement',
    'assessment_share'
  );

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
    WHEN 'approval_request'    THEN true
    WHEN 'approval_result'     THEN true
    WHEN 'danger_zone_entry'   THEN true
    WHEN 'suspended_site_entry' THEN true
    WHEN 'announcement'        THEN true
    WHEN 'assessment_share'    THEN true
    WHEN 'return_request'      THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection'   THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit'         THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm'                 THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning'      THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due'  THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident'            THEN true
    WHEN 'todo_due'            THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result'   THEN COALESCE(p.event_assessment_result, true)
    ELSE COALESCE(p.event_general, true)
  END;
END;
$function$;

-- Attendance geometry in SQL so the already-deployed track-location
-- (it writes worker_last_positions) can raise the alarm without a new deploy.

CREATE OR REPLACE FUNCTION public.geo_haversine_m(
  _lat1 float8, _lng1 float8, _lat2 float8, _lng2 float8
)
RETURNS float8
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 2 * 6371000 * asin(sqrt(least(1::float8,
    sin(radians(_lat2 - _lat1) / 2) ^ 2
    + cos(radians(_lat1)) * cos(radians(_lat2)) * sin(radians(_lng2 - _lng1) / 2) ^ 2
  )));
$$;

CREATE OR REPLACE FUNCTION public.point_in_geo_polygon(_lat float8, _lng float8, _poly jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n int;
  i int;
  j int;
  yi float8;
  xi float8;
  yj float8;
  xj float8;
  inside boolean := false;
BEGIN
  IF _poly IS NULL OR jsonb_typeof(_poly) <> 'array' THEN
    RETURN false;
  END IF;
  n := jsonb_array_length(_poly);
  IF n < 3 THEN
    RETURN false;
  END IF;
  j := n - 1;
  FOR i IN 0..n - 1 LOOP
    yi := (_poly -> i ->> 'lat')::float8;
    xi := (_poly -> i ->> 'lng')::float8;
    yj := (_poly -> j ->> 'lat')::float8;
    xj := (_poly -> j ->> 'lng')::float8;
    IF (yi > _lat) IS DISTINCT FROM (yj > _lat)
       AND _lng < ((xj - xi) * (_lat - yi) / COALESCE(NULLIF(yj - yi, 0), 1e-12) + xi) THEN
      inside := NOT inside;
    END IF;
    j := i;
  END LOOP;
  RETURN inside;
END;
$$;

CREATE OR REPLACE FUNCTION public.geo_point_to_segment_m(
  _plat float8, _plng float8,
  _alat float8, _alng float8,
  _blat float8, _blng float8
)
RETURNS float8
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  m_lng float8 := 111195 * cos(radians(_alat));
  seg_x float8 := (_blng - _alng) * m_lng;
  seg_y float8 := (_blat - _alat) * 111195;
  pt_x float8 := (_plng - _alng) * m_lng;
  pt_y float8 := (_plat - _alat) * 111195;
  ab2 float8 := seg_x * seg_x + seg_y * seg_y;
  t float8;
  dx float8;
  dy float8;
BEGIN
  IF ab2 < 1e-12 THEN
    RETURN public.geo_haversine_m(_plat, _plng, _alat, _alng);
  END IF;
  t := greatest(0, least(1, (pt_x * seg_x + pt_y * seg_y) / ab2));
  dx := pt_x - t * seg_x;
  dy := pt_y - t * seg_y;
  RETURN sqrt(dx * dx + dy * dy);
END;
$$;

CREATE OR REPLACE FUNCTION public.point_within_attendance(
  _lat float8,
  _lng float8,
  _geometry_type text,
  _geo_polygon jsonb,
  _center_lat float8,
  _center_lng float8,
  _radius_m float8,
  _buffer_m float8,
  _accuracy_m float8
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  buf float8;
  acc float8;
  pad float8;
  dist float8;
  n int;
  i int;
  closed boolean;
  edge_count int;
  alat float8;
  alng float8;
  blat float8;
  blng float8;
  poly jsonb := _geo_polygon;
BEGIN
  buf := COALESCE(_buffer_m, 150);
  IF buf < 100 THEN buf := 100; END IF;
  IF buf > 300 THEN buf := 300; END IF;
  buf := round(buf);
  acc := COALESCE(_accuracy_m, 0);
  IF acc < 0 THEN acc := 0; END IF;
  pad := least(acc, 40);

  IF COALESCE(_geometry_type, 'radius') = 'radius'
     OR poly IS NULL
     OR jsonb_typeof(poly) <> 'array'
     OR jsonb_array_length(poly) < 3 THEN
    IF _center_lat IS NULL OR _center_lng IS NULL OR COALESCE(_radius_m, 0) <= 0 THEN
      RETURN false;
    END IF;
    dist := public.geo_haversine_m(_lat, _lng, _center_lat, _center_lng) - _radius_m;
    IF dist < 0 THEN dist := 0; END IF;
    RETURN dist <= buf + pad;
  END IF;

  IF public.point_in_geo_polygon(_lat, _lng, poly) THEN
    dist := 0;
  ELSE
    n := jsonb_array_length(poly);
    closed := n > 2
      AND (poly -> 0 ->> 'lat') = (poly -> (n - 1) ->> 'lat')
      AND (poly -> 0 ->> 'lng') = (poly -> (n - 1) ->> 'lng');
    edge_count := CASE WHEN closed THEN n - 1 ELSE n END;
    dist := 1e12;
    FOR i IN 0..edge_count - 1 LOOP
      alat := (poly -> i ->> 'lat')::float8;
      alng := (poly -> i ->> 'lng')::float8;
      blat := (poly -> ((i + 1) % n) ->> 'lat')::float8;
      blng := (poly -> ((i + 1) % n) ->> 'lng')::float8;
      dist := least(dist, public.geo_point_to_segment_m(_lat, _lng, alat, alng, blat, blng));
    END LOOP;
  END IF;
  RETURN dist <= buf + pad;
END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_spot_name(
  _project_id uuid,
  _lat float8,
  _lng float8,
  _accuracy_m float8
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s record;
  has_spots boolean := false;
  b_name text;
  b_type text;
  b_poly jsonb;
  b_lat float8;
  b_lng float8;
  b_radius float8;
  b_buffer float8;
  pin_lat float8;
  pin_lng float8;
  acc float8 := greatest(COALESCE(_accuracy_m, 0), 0);
  d float8;
BEGIN
  IF _project_id IS NULL OR _lat IS NULL OR _lng IS NULL THEN
    RETURN NULL;
  END IF;

  FOR s IN
    SELECT name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, buffer_m
      FROM public.project_site_spots
     WHERE project_id = _project_id
       AND is_deleted = false
       AND is_active = true
     ORDER BY sort_order, created_at
  LOOP
    has_spots := true;
    IF public.point_within_attendance(
      _lat, _lng, s.geometry_type, s.geo_polygon,
      s.center_lat, s.center_lng, s.radius_m, s.buffer_m, _accuracy_m
    ) THEN
      RETURN COALESCE(NULLIF(btrim(s.name), ''), '현장');
    END IF;
  END LOOP;

  -- Drawn 개소 are the attendance SSOT. A miss is outside, not the address pin.
  IF has_spots THEN
    RETURN NULL;
  END IF;

  SELECT b.name, b.geometry_type, b.geo_polygon, b.center_lat, b.center_lng, b.radius_m, b.buffer_m
    INTO b_name, b_type, b_poly, b_lat, b_lng, b_radius, b_buffer
    FROM public.project_site_boundaries b
   WHERE b.project_id = _project_id
     AND b.is_deleted = false
     AND b.is_active = true
   LIMIT 1;
  IF FOUND AND public.point_within_attendance(
    _lat, _lng, b_type, b_poly, b_lat, b_lng, b_radius, b_buffer, _accuracy_m
  ) THEN
    RETURN COALESCE(NULLIF(btrim(b_name), ''), '현장');
  END IF;

  SELECT site_lat, site_lng INTO pin_lat, pin_lng
    FROM public.projects WHERE id = _project_id;
  IF pin_lat IS NOT NULL AND pin_lng IS NOT NULL THEN
    d := public.geo_haversine_m(_lat, _lng, pin_lat, pin_lng);
    IF d <= 350 + least(acc, 80) THEN
      RETURN '현장';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_spot_name(uuid, float8, float8, float8)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_spot_name(uuid, float8, float8, float8)
  TO service_role;

CREATE OR REPLACE FUNCTION public.trg_worker_position_suspended_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _spot text;
  _watch boolean;
BEGIN
  SELECT
    (w.site_entry_suspended_until IS NOT NULL AND w.site_entry_suspended_until > now())
    OR EXISTS (
      SELECT 1
        FROM public.worker_suspension_site_presence p
       WHERE p.worker_id = NEW.worker_id
         AND p.project_id = NEW.project_id
         AND p.inside
    )
    INTO _watch
    FROM public.workers w
   WHERE w.id = NEW.worker_id;

  IF NOT COALESCE(_watch, false) THEN
    RETURN NEW;
  END IF;

  _spot := public.attendance_spot_name(NEW.project_id, NEW.lat, NEW.lng, NEW.accuracy_m);
  PERFORM public.notify_suspended_site_entry(
    NEW.project_id,
    NEW.worker_id,
    _spot IS NOT NULL,
    _spot
  );
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
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_worker_position_suspended_entry();

-- Clock-in was already refused. Clock-out is refused the same way so a
-- suspended worker cannot end tracking by checking out.

CREATE OR REPLACE FUNCTION public.worker_gps_daily_lifecycle(
  _action text,
  _worker_id uuid,
  _project_id uuid,
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL,
  _accuracy double precision DEFAULT NULL,
  _signature text DEFAULT NULL,
  _site_spot_id uuid DEFAULT NULL,
  _site_spot_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _uid uuid := auth.uid();
  _phone text;
  _digits text;
  _w record;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  _log record;
  _new_id uuid;
  _spot_id uuid := _site_spot_id;
  _spot_name text := NULLIF(btrim(COALESCE(_site_spot_name, '')), '');
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  IF _action IS NULL OR _action NOT IN ('entry', 'ack', 'exit') THEN
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
  END IF;

  IF _worker_id IS NULL OR _project_id IS NULL THEN
    RETURN jsonb_build_object('error', 'INVALID_ARGS');
  END IF;

  SELECT phone INTO _phone FROM public.profiles WHERE user_id = _uid LIMIT 1;
  _digits := public.normalize_phone_digits(_phone);

  IF COALESCE(_digits, '') = '' AND NOT public.is_master(_uid) THEN
    RETURN jsonb_build_object('error', 'PHONE_REQUIRED', 'message', '프로필 전화번호가 필요합니다.');
  END IF;

  SELECT w.id, w.project_id, w.phone, w.is_active, w.company_id,
         w.site_entry_suspended_until, w.site_entry_suspension_reason
    INTO _w
    FROM public.workers w
   WHERE w.id = _worker_id
     AND w.project_id = _project_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'WORKER_NOT_FOUND');
  END IF;

  IF COALESCE(_w.is_active, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', 'WORKER_INACTIVE');
  END IF;

  IF NOT public.is_master(_uid) THEN
    IF public.normalize_phone_digits(_w.phone) IS DISTINCT FROM _digits THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN', 'message', '본인 근로자 기록만 처리할 수 있습니다.');
    END IF;
    IF NOT public.is_project_member(_uid, _project_id) THEN
      RETURN jsonb_build_object('error', 'NOT_PROJECT_MEMBER');
    END IF;
  END IF;

  IF _spot_id IS NOT NULL THEN
    SELECT s.id, s.name INTO _spot_id, _spot_name
      FROM public.project_site_spots s
     WHERE s.id = _spot_id
       AND s.project_id = _project_id
       AND s.is_deleted = false
       AND s.is_active = true;
    IF NOT FOUND THEN
      _spot_id := NULL;
      _spot_name := NULLIF(btrim(COALESCE(_site_spot_name, '')), '');
    ELSIF NULLIF(btrim(COALESCE(_site_spot_name, '')), '') IS NOT NULL THEN
      _spot_name := btrim(_site_spot_name);
    END IF;
  END IF;

  IF _action IN ('entry', 'exit')
     AND _w.site_entry_suspended_until IS NOT NULL
     AND _w.site_entry_suspended_until > now() THEN
    RETURN jsonb_build_object(
      'error', 'SUSPENDED',
      'until', _w.site_entry_suspended_until,
      'reason', _w.site_entry_suspension_reason
    );
  END IF;

  IF _action = 'entry' THEN

    SELECT id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed,
           entry_site_spot_id, entry_site_spot_name
      INTO _log
      FROM public.worker_entry_logs
     WHERE worker_id = _worker_id
       AND project_id = _project_id
       AND exit_at IS NULL
       AND (entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
     ORDER BY entry_at DESC
     LIMIT 1;

    IF FOUND THEN
      IF _spot_id IS NOT NULL AND _log.entry_site_spot_id IS NULL THEN
        UPDATE public.worker_entry_logs
           SET entry_site_spot_id = _spot_id,
               entry_site_spot_name = _spot_name
         WHERE id = _log.id;
        _log.entry_site_spot_id := _spot_id;
        _log.entry_site_spot_name := _spot_name;
      END IF;
      PERFORM public.upsert_worker_last_position_from_checkin(
        _worker_id, _project_id, _w.company_id, _lat, _lng, _accuracy
      );
      RETURN jsonb_build_object(
        'success', true,
        'action', 'entry',
        'already', true,
        'log', jsonb_build_object(
          'id', _log.id,
          'entry_at', _log.entry_at,
          'exit_at', _log.exit_at,
          'tbm_confirmed', _log.tbm_confirmed,
          'no_accident_confirmed', _log.no_accident_confirmed,
          'entry_site_spot_id', _log.entry_site_spot_id,
          'entry_site_spot_name', _log.entry_site_spot_name
        )
      );
    END IF;

    INSERT INTO public.worker_entry_logs (
      worker_id, project_id, entry_at, entry_method,
      tbm_confirmed, no_accident_confirmed,
      risk_assessment_confirmed, education_confirmed,
      entry_site_spot_id, entry_site_spot_name
    ) VALUES (
      _worker_id, _project_id, now(), 'gps',
      false, false, false, false,
      _spot_id, _spot_name
    ) RETURNING id INTO _new_id;

    PERFORM public.upsert_worker_last_position_from_checkin(
      _worker_id, _project_id, _w.company_id, _lat, _lng, _accuracy
    );

    SELECT id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed,
           entry_site_spot_id, entry_site_spot_name
      INTO _log
      FROM public.worker_entry_logs
     WHERE id = _new_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'entry',
      'already', false,
      'log', jsonb_build_object(
        'id', _log.id,
        'entry_at', _log.entry_at,
        'exit_at', _log.exit_at,
        'tbm_confirmed', _log.tbm_confirmed,
        'no_accident_confirmed', _log.no_accident_confirmed,
        'entry_site_spot_id', _log.entry_site_spot_id,
        'entry_site_spot_name', _log.entry_site_spot_name
      ),
      'gps', CASE WHEN _lat IS NULL THEN NULL ELSE jsonb_build_object(
        'lat', _lat, 'lng', _lng, 'accuracy', _accuracy
      ) END
    );
  END IF;

  SELECT id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed,
         entry_site_spot_id, entry_site_spot_name
    INTO _log
    FROM public.worker_entry_logs
   WHERE worker_id = _worker_id
     AND project_id = _project_id
     AND (entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
   ORDER BY entry_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NO_ENTRY', 'message', '오늘 출근 기록이 없습니다.');
  END IF;

  IF _action = 'ack' THEN
    IF _log.exit_at IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'ALREADY_EXITED');
    END IF;

    UPDATE public.worker_entry_logs
       SET tbm_confirmed = true,
           risk_assessment_confirmed = true
     WHERE id = _log.id
    RETURNING id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed,
              entry_site_spot_id, entry_site_spot_name INTO _log;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'ack',
      'log', jsonb_build_object(
        'id', _log.id,
        'entry_at', _log.entry_at,
        'exit_at', _log.exit_at,
        'tbm_confirmed', _log.tbm_confirmed,
        'no_accident_confirmed', _log.no_accident_confirmed,
        'entry_site_spot_id', _log.entry_site_spot_id,
        'entry_site_spot_name', _log.entry_site_spot_name
      )
    );
  END IF;

  IF _log.exit_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'exit',
      'already', true,
      'log', jsonb_build_object(
        'id', _log.id,
        'entry_at', _log.entry_at,
        'exit_at', _log.exit_at,
        'tbm_confirmed', _log.tbm_confirmed,
        'no_accident_confirmed', _log.no_accident_confirmed,
        'entry_site_spot_id', _log.entry_site_spot_id,
        'entry_site_spot_name', _log.entry_site_spot_name
      )
    );
  END IF;

  UPDATE public.worker_entry_logs
     SET exit_at = now(),
         no_accident_confirmed = true,
         exit_signature_data = CASE
           WHEN _signature IS NOT NULL AND length(_signature) >= 100 THEN _signature
           ELSE exit_signature_data
         END
   WHERE id = _log.id
  RETURNING id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed,
            entry_site_spot_id, entry_site_spot_name INTO _log;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'exit',
    'already', false,
    'log', jsonb_build_object(
      'id', _log.id,
      'entry_at', _log.entry_at,
      'exit_at', _log.exit_at,
      'tbm_confirmed', _log.tbm_confirmed,
      'no_accident_confirmed', _log.no_accident_confirmed,
      'entry_site_spot_id', _log.entry_site_spot_id,
      'entry_site_spot_name', _log.entry_site_spot_name
    )
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision, text, uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision, text, uuid, text)
  IS 'Authenticated worker GPS check-in / daily ack / check-out. Entry and exit are refused while site entry is suspended.';

