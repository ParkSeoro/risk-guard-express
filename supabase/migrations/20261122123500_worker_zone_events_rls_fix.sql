-- PR 1-A: Fix worker_zone_events SELECT/UPDATE RLS policies.
--
-- Root cause (verified on live DB 2026-11-22):
--   1) track-location/index.ts (and FK migration 20260811045000) writes workers.id into
--      worker_zone_events.worker_qr_id, retiring worker_daily_qr.id.
--      However, SELECT policy "admins view zone events" (20260629025011) still joined
--      worker_daily_qr.id = worker_zone_events.worker_qr_id, making all new events
--      invisible (0 rows) to every non-master admin.
--   2) UPDATE policy "members ack events" (20260624003444) only checked project_members
--      membership without role, company, or column immutability checks.
--
-- Policy design (agreed by Antigravity & Cursor, approved by 박서로님 2026-11-22):
--   - SELECT: master; project admins (project_admin / OWNER_PM / OWNER_CM) project-wide;
--     management roles (safety_manager, site_manager, supervisor, site_supervisor and
--     matching positions) + client_safety_viewer within can_read_company_data scope.
--     Plain workers and non-safety viewers are excluded.
--   - UPDATE (ack): EXACT match with trg_zone_event_notify push recipients —
--     master; project admins (project_admin / OWNER_PM / OWNER_CM) project-wide;
--     violator's own company managers (pm.company_id = violator_company_id AND
--     role/position in safety_manager/site_manager/site_supervisor set).
--     Workers and viewers cannot ack.
--   - Column guard: non-master authenticated UPDATEs may only modify acknowledge fields
--     (acknowledged, acknowledged_by, acknowledged_at, notes); cron/service_role
--     (auth.uid() IS NULL) remains unaffected so anonymize_old_location_data keeps working.

ALTER TABLE public.worker_zone_events ENABLE ROW LEVEL SECURITY;

-- Supporting partial index for workers.id RLS lookup
CREATE INDEX IF NOT EXISTS idx_wze_worker_qr_id
  ON public.worker_zone_events (worker_qr_id)
  WHERE worker_qr_id IS NOT NULL;

-- Internal company resolver matching trg_zone_event_notify lookup order.
-- Not directly callable by anon/authenticated (called only by RLS helpers below).
CREATE OR REPLACE FUNCTION public.resolve_zone_event_company_id(
  _project_id uuid,
  _worker_qr_id uuid,
  _worker_phone text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id uuid := NULL;
  _digits text;
BEGIN
  -- Primary path: worker_qr_id references workers(id) (post-20260811045000 FK)
  IF _worker_qr_id IS NOT NULL THEN
    SELECT w.company_id
      INTO _company_id
      FROM public.workers w
     WHERE w.id = _worker_qr_id
     LIMIT 1;
  END IF;

  -- Phone fallback: historical NULL worker_qr_id rows & manager/admin triggers
  IF _company_id IS NULL AND _worker_phone IS NOT NULL AND btrim(_worker_phone) <> '' THEN
    _digits := regexp_replace(_worker_phone, '[^0-9]', '', 'g');
    IF _digits <> '' THEN
      SELECT w.company_id
        INTO _company_id
        FROM public.workers w
       WHERE w.project_id = _project_id
         AND regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g') = _digits
       ORDER BY COALESCE(w.is_active, true) DESC, w.created_at DESC
       LIMIT 1;

      IF _company_id IS NULL THEN
        SELECT pm.company_id
          INTO _company_id
          FROM public.profiles p
          JOIN public.project_members pm ON pm.user_id = p.user_id
         WHERE pm.project_id = _project_id
           AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') = _digits
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  RETURN _company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_zone_event_company_id(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- RLS SELECT predicate: derives caller from (select auth.uid()) internally (no spoofing).
CREATE OR REPLACE FUNCTION public.can_view_zone_event(
  _project_id uuid,
  _worker_qr_id uuid,
  _worker_phone text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _company_id uuid;
BEGIN
  IF _uid IS NULL OR _project_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_master(_uid) THEN
    RETURN true;
  END IF;

  -- Project-wide admin (matches trg_zone_event_notify group 2)
  IF EXISTS (
    SELECT 1
      FROM public.project_members pm
     WHERE pm.project_id = _project_id
       AND pm.user_id = _uid
       AND lower(COALESCE(pm.role_new::text, '')) NOT IN ('worker', 'viewer')
       AND (
         lower(COALESCE(pm.role_new::text, '')) = 'project_admin'
         OR upper(COALESCE(pm.position_new::text, '')) IN ('OWNER_PM', 'OWNER_CM')
       )
  ) THEN
    RETURN true;
  END IF;

  -- Management roles or client safety viewer within company read scope
  IF NOT (
    public.is_client_safety_viewer(_uid, _project_id)
    OR EXISTS (
      SELECT 1
        FROM public.project_members pm
       WHERE pm.project_id = _project_id
         AND pm.user_id = _uid
         AND lower(COALESCE(pm.role_new::text, '')) NOT IN ('worker', 'viewer')
         AND (
           lower(COALESCE(pm.role_new::text, '')) IN (
             'safety_manager', 'site_manager', 'supervisor', 'site_supervisor'
           )
           OR upper(COALESCE(pm.position_new::text, '')) IN (
             'SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'OWNER_SM',
             'SITE_SUPERVISOR', 'SUPERVISOR'
           )
         )
    )
  ) THEN
    RETURN false;
  END IF;

  _company_id := public.resolve_zone_event_company_id(_project_id, _worker_qr_id, _worker_phone);
  RETURN public.can_read_company_data(_uid, _project_id, _company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_zone_event(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_zone_event(uuid, uuid, text) TO authenticated;

-- RLS UPDATE (ack) predicate: EXACT match with trg_zone_event_notify push recipients.
-- Group (2): project_admin / OWNER_PM / OWNER_CM (project-wide).
-- Group (3): violator's exact company managers (pm.company_id = violator_company_id).
-- Workers and read-only viewers are strictly excluded.
CREATE OR REPLACE FUNCTION public.can_ack_zone_event(
  _project_id uuid,
  _worker_qr_id uuid,
  _worker_phone text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _company_id uuid;
BEGIN
  IF _uid IS NULL OR _project_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_master(_uid) THEN
    RETURN true;
  END IF;

  -- Recipient group (2): Project-wide admins (project_admin / OWNER_PM / OWNER_CM)
  IF EXISTS (
    SELECT 1
      FROM public.project_members pm
     WHERE pm.project_id = _project_id
       AND pm.user_id = _uid
       AND lower(COALESCE(pm.role_new::text, '')) NOT IN ('worker', 'viewer')
       AND (
         lower(COALESCE(pm.role_new::text, '')) = 'project_admin'
         OR upper(COALESCE(pm.position_new::text, '')) IN ('OWNER_PM', 'OWNER_CM')
       )
  ) THEN
    RETURN true;
  END IF;

  -- Recipient group (3): Violator's exact company managers only (matches notify_project_roles)
  _company_id := public.resolve_zone_event_company_id(_project_id, _worker_qr_id, _worker_phone);
  IF _company_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.project_members pm
     WHERE pm.project_id = _project_id
       AND pm.user_id = _uid
       AND pm.company_id = _company_id
       AND lower(COALESCE(pm.role_new::text, '')) NOT IN ('worker', 'viewer')
       AND (
         lower(COALESCE(pm.role_new::text, '')) IN (
           'safety_manager', 'site_manager', 'site_supervisor'
         )
         OR upper(COALESCE(pm.position_new::text, '')) IN (
           'SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'OWNER_SM',
           'SITE_SUPERVISOR', 'SUPERVISOR'
         )
       )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_ack_zone_event(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_ack_zone_event(uuid, uuid, text) TO authenticated;

-- Protect immutable audit columns on authenticated non-master UPDATEs (ack only).
-- Cron/service_role (auth.uid() IS NULL) and master bypass so anonymize_old_location_data works.
CREATE OR REPLACE FUNCTION public.guard_worker_zone_events_ack_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := (SELECT auth.uid());
BEGIN
  IF _uid IS NULL OR public.is_master(_uid) THEN
    RETURN NEW;
  END IF;

  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.zone_id IS DISTINCT FROM OLD.zone_id
     OR NEW.restricted_zone_id IS DISTINCT FROM OLD.restricted_zone_id
     OR NEW.worker_qr_id IS DISTINCT FROM OLD.worker_qr_id
     OR NEW.worker_name IS DISTINCT FROM OLD.worker_name
     OR NEW.worker_phone IS DISTINCT FROM OLD.worker_phone
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.position_x IS DISTINCT FROM OLD.position_x
     OR NEW.position_y IS DISTINCT FROM OLD.position_y
     OR NEW.lat IS DISTINCT FROM OLD.lat
     OR NEW.lng IS DISTINCT FROM OLD.lng
     OR NEW.accuracy_m IS DISTINCT FROM OLD.accuracy_m
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'zone_event_immutable_columns'
      USING ERRCODE = '42501', HINT = '구역 출입 이력의 원본 필드는 수정할 수 없습니다.';
  END IF;

  IF NEW.acknowledged = true AND OLD.acknowledged IS DISTINCT FROM true THEN
    NEW.acknowledged_by := COALESCE(NEW.acknowledged_by, _uid);
    NEW.acknowledged_at := COALESCE(NEW.acknowledged_at, now());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_worker_zone_events_ack_update()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_worker_zone_events_ack_guard ON public.worker_zone_events;
CREATE TRIGGER trg_worker_zone_events_ack_guard
  BEFORE UPDATE ON public.worker_zone_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_worker_zone_events_ack_update();

DROP POLICY IF EXISTS "admins view zone events" ON public.worker_zone_events;
CREATE POLICY "admins view zone events"
  ON public.worker_zone_events
  FOR SELECT
  TO authenticated
  USING (public.can_view_zone_event(project_id, worker_qr_id, worker_phone));

DROP POLICY IF EXISTS "members ack events" ON public.worker_zone_events;
CREATE POLICY "members ack events"
  ON public.worker_zone_events
  FOR UPDATE
  TO authenticated
  USING (public.can_ack_zone_event(project_id, worker_qr_id, worker_phone))
  WITH CHECK (public.can_ack_zone_event(project_id, worker_qr_id, worker_phone));
