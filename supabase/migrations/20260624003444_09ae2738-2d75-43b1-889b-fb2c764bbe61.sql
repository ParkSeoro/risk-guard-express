CREATE TABLE public.site_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT,
  width_px INTEGER, height_px INTEGER,
  width_m NUMERIC, height_m NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_maps TO authenticated;
GRANT ALL ON public.site_maps TO service_role;
ALTER TABLE public.site_maps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view site_maps" ON public.site_maps FOR SELECT TO authenticated
USING (public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = site_maps.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "masters manage site_maps" ON public.site_maps FOR ALL TO authenticated
USING (public.is_master(auth.uid())) WITH CHECK (public.is_master(auth.uid()));

CREATE TABLE public.site_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_map_id UUID NOT NULL REFERENCES public.site_maps(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  zone_type TEXT NOT NULL DEFAULT 'normal',
  color TEXT,
  polygon JSONB NOT NULL,
  description TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_zones TO authenticated;
GRANT ALL ON public.site_zones TO service_role;
ALTER TABLE public.site_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view zones" ON public.site_zones FOR SELECT TO authenticated
USING (public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = site_zones.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "masters manage zones" ON public.site_zones FOR ALL TO authenticated
USING (public.is_master(auth.uid())) WITH CHECK (public.is_master(auth.uid()));

CREATE TABLE public.zone_qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES public.site_zones(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  label TEXT,
  direction TEXT NOT NULL DEFAULT 'entry',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zone_qr_codes TO authenticated;
GRANT SELECT ON public.zone_qr_codes TO anon;
GRANT ALL ON public.zone_qr_codes TO service_role;
ALTER TABLE public.zone_qr_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view qr" ON public.zone_qr_codes FOR SELECT TO authenticated
USING (public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = zone_qr_codes.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "anon view active qr" ON public.zone_qr_codes FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "masters manage qr" ON public.zone_qr_codes FOR ALL TO authenticated
USING (public.is_master(auth.uid())) WITH CHECK (public.is_master(auth.uid()));

CREATE TABLE public.worker_zone_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES public.site_zones(id) ON DELETE SET NULL,
  worker_qr_id UUID REFERENCES public.worker_daily_qr(id) ON DELETE SET NULL,
  worker_name TEXT,
  worker_phone TEXT,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'qr',
  position_x NUMERIC, position_y NUMERIC,
  notes TEXT,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wze_project_time ON public.worker_zone_events(project_id, created_at DESC);
CREATE INDEX idx_wze_unack ON public.worker_zone_events(project_id, event_type) WHERE acknowledged = false;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_zone_events TO authenticated;
GRANT INSERT ON public.worker_zone_events TO anon;
GRANT ALL ON public.worker_zone_events TO service_role;
ALTER TABLE public.worker_zone_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view events" ON public.worker_zone_events FOR SELECT TO authenticated
USING (public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = worker_zone_events.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "anyone insert events" ON public.worker_zone_events FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "members ack events" ON public.worker_zone_events FOR UPDATE TO authenticated
USING (public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = worker_zone_events.project_id AND pm.user_id = auth.uid()))
WITH CHECK (public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = worker_zone_events.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "masters delete events" ON public.worker_zone_events FOR DELETE TO authenticated USING (public.is_master(auth.uid()));

CREATE TRIGGER trg_site_maps_updated BEFORE UPDATE ON public.site_maps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_site_zones_updated BEFORE UPDATE ON public.site_zones FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();