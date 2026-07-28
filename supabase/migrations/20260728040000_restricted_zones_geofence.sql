-- Restricted (danger) zones with ban-target mapping for geofence voice/push alerts.
-- Complements site_zones (map-overlay polygons) with GPS-native polygon/radius geometry
-- and explicit ban lists (worker / company / job type).

CREATE TABLE IF NOT EXISTS public.restricted_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  geometry_type TEXT NOT NULL DEFAULT 'radius'
    CHECK (geometry_type IN ('polygon', 'radius')),
  geo_polygon JSONB,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  radius_m NUMERIC,
  -- Empty arrays ⇒ ban everyone entering the zone
  banned_worker_ids UUID[] NOT NULL DEFAULT '{}',
  banned_company_ids UUID[] NOT NULL DEFAULT '{}',
  banned_job_types TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id),
  deleted_reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT restricted_zones_geom_check CHECK (
    (geometry_type = 'radius'
      AND center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_m IS NOT NULL AND radius_m > 0)
    OR
    (geometry_type = 'polygon' AND geo_polygon IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_restricted_zones_project
  ON public.restricted_zones(project_id) WHERE is_deleted = false AND is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restricted_zones TO authenticated;
GRANT ALL ON public.restricted_zones TO service_role;

ALTER TABLE public.restricted_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members view restricted_zones" ON public.restricted_zones;
CREATE POLICY "members view restricted_zones" ON public.restricted_zones
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = restricted_zones.project_id AND pm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admins manage restricted_zones" ON public.restricted_zones;
CREATE POLICY "admins manage restricted_zones" ON public.restricted_zones
  FOR ALL TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = restricted_zones.project_id
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
      WHERE pm.project_id = restricted_zones.project_id
        AND pm.user_id = auth.uid()
        AND (
          COALESCE(pm.role_new::text, '') IN ('project_admin', 'safety_manager')
          OR pm.position_new IN ('SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'SUPERVISOR')
        )
    )
  );

DROP TRIGGER IF EXISTS trg_restricted_zones_updated ON public.restricted_zones;
CREATE TRIGGER trg_restricted_zones_updated
  BEFORE UPDATE ON public.restricted_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Link zone events to restricted_zones for admin push payload
ALTER TABLE public.worker_zone_events
  ADD COLUMN IF NOT EXISTS restricted_zone_id UUID REFERENCES public.restricted_zones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wze_restricted_zone
  ON public.worker_zone_events(restricted_zone_id)
  WHERE restricted_zone_id IS NOT NULL;

-- Extend notify trigger to resolve name from restricted_zones when site zone missing
CREATE OR REPLACE FUNCTION public.trg_zone_event_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  z record;
  rz record;
  worker_uid uuid;
  display_name text;
  zone_label text;
  zone_name text;
  link_url text;
BEGIN
  IF NEW.event_type <> 'unauthorized_entry' THEN
    RETURN NEW;
  END IF;

  zone_label := '위험구역';
  zone_name := '위험구역';

  IF NEW.zone_id IS NOT NULL THEN
    SELECT id, name, zone_type INTO z
      FROM public.site_zones WHERE id = NEW.zone_id;
    IF FOUND THEN
      zone_label := CASE COALESCE(z.zone_type,'danger')
                      WHEN 'restricted' THEN '제한구역' ELSE '위험구역' END;
      zone_name := COALESCE(z.name, zone_name);
    END IF;
  END IF;

  IF NEW.restricted_zone_id IS NOT NULL THEN
    SELECT id, name INTO rz FROM public.restricted_zones WHERE id = NEW.restricted_zone_id;
    IF FOUND THEN
      zone_label := '위험구역';
      zone_name := COALESCE(rz.name, zone_name);
    END IF;
  END IF;

  link_url := '/zone-events?project=' || NEW.project_id::text;
  display_name := COALESCE(NEW.worker_name, '근로자');

  worker_uid := NULL;
  IF NEW.worker_phone IS NOT NULL AND NEW.worker_phone <> '' THEN
    SELECT user_id INTO worker_uid FROM public.profiles
      WHERE phone = NEW.worker_phone LIMIT 1;
  END IF;
  IF worker_uid IS NULL AND NEW.worker_qr_id IS NOT NULL THEN
    SELECT p.user_id INTO worker_uid
      FROM public.workers w
      JOIN public.profiles p ON p.phone = w.phone
     WHERE w.id = NEW.worker_qr_id LIMIT 1;
  END IF;

  IF worker_uid IS NOT NULL THEN
    INSERT INTO public.notifications
      (user_id, project_id, type, title, message, body, related_type, related_id,
       link, severity, is_read)
    VALUES
      (worker_uid, NEW.project_id, 'danger_zone_entry',
       '⚠️ ' || zone_label || ' 진입 경고',
       zone_name || '에 진입했습니다. 즉시 이탈하십시오.',
       zone_name || '에 진입했습니다. 즉시 이탈하십시오.',
       'zone_event', NEW.id::text, link_url, 'high', false);
  END IF;

  -- 관리자: "긴급: OOO 근로자 위험 구역 진입"
  INSERT INTO public.notifications
    (user_id, project_id, type, title, message, body, related_type, related_id,
     link, severity, is_read)
  SELECT DISTINCT pm.user_id, NEW.project_id, 'danger_zone_entry',
         '🚨 긴급: ' || display_name || ' 근로자 위험 구역 진입',
         display_name || ' 근로자가 ' || zone_name || '에 진입했습니다. 즉시 확인하세요.',
         display_name || ' 근로자가 ' || zone_name || '에 진입했습니다. 즉시 확인하세요.',
         'zone_event', NEW.id::text, link_url, 'high', false
    FROM public.project_members pm
   WHERE pm.project_id = NEW.project_id
     AND pm.user_id IS NOT NULL
     AND (worker_uid IS NULL OR pm.user_id <> worker_uid)
     AND (
          pm.position_new IN ('SITE_MANAGER','HSE_MANAGER','OWNER_HSE','SUPERVISOR')
       OR COALESCE(pm.role_new::text,'') IN ('project_admin','safety_manager')
     );

  RETURN NEW;
END;
$$;
