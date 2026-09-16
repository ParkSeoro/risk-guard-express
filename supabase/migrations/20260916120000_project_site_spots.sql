-- GPS 개소: 한 프로젝트 안에 여러 출근·체류 펜스.
-- TBM·허가서·RA는 프로젝트 스코프 그대로. 근로자는 개소를 고르지 않는다.

CREATE TABLE IF NOT EXISTS public.project_site_spots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  radius_m NUMERIC NOT NULL DEFAULT 400
    CHECK (radius_m >= 50 AND radius_m <= 2500),
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_site_spots_project
  ON public.project_site_spots(project_id)
  WHERE is_deleted = false AND is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_site_spots TO authenticated;
GRANT ALL ON public.project_site_spots TO service_role;

ALTER TABLE public.project_site_spots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members view project_site_spots" ON public.project_site_spots;
CREATE POLICY "members view project_site_spots" ON public.project_site_spots
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_site_spots.project_id AND pm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admins manage project_site_spots" ON public.project_site_spots;
CREATE POLICY "admins manage project_site_spots" ON public.project_site_spots
  FOR ALL TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_site_spots.project_id
        AND pm.user_id = auth.uid()
        AND (
          COALESCE(pm.role_new::text, '') IN ('project_admin', 'safety_manager')
          OR pm.position_new IN ('SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'SUPERVISOR')
        )
    )
  )
  WITH CHECK (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_site_spots.project_id
        AND pm.user_id = auth.uid()
        AND (
          COALESCE(pm.role_new::text, '') IN ('project_admin', 'safety_manager')
          OR pm.position_new IN ('SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'SUPERVISOR')
        )
    )
  );

DROP TRIGGER IF EXISTS trg_project_site_spots_updated ON public.project_site_spots;
CREATE TRIGGER trg_project_site_spots_updated
  BEFORE UPDATE ON public.project_site_spots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.worker_entry_logs
  ADD COLUMN IF NOT EXISTS entry_site_spot_id UUID REFERENCES public.project_site_spots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entry_site_spot_name TEXT;

CREATE INDEX IF NOT EXISTS idx_worker_entry_logs_entry_spot
  ON public.worker_entry_logs(entry_site_spot_id)
  WHERE entry_site_spot_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision, text);

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

  IF _action = 'entry' THEN
    IF _w.site_entry_suspended_until IS NOT NULL AND _w.site_entry_suspended_until > now() THEN
      RETURN jsonb_build_object(
        'error', 'SUSPENDED',
        'until', _w.site_entry_suspended_until,
        'reason', _w.site_entry_suspension_reason
      );
    END IF;

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
  IS 'Authenticated worker GPS check-in / daily ack / check-out. Optional site spot is recorded at entry only.';

COMMENT ON TABLE public.project_site_spots IS
  'Project GPS 개소 (name + circle). Empty table ⇒ legacy one-circle site fence.';
