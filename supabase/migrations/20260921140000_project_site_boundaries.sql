-- Site outline for attendance (stroke on the control map).
-- Clock-in/out = inside the shape or within buffer_m (100–300) of the edge.
-- Not a restricted_zone: no fill, no siren, no ban lists.

CREATE TABLE IF NOT EXISTS public.project_site_boundaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '현장 테두리',
  geometry_type TEXT NOT NULL DEFAULT 'polygon'
    CHECK (geometry_type IN ('polygon', 'radius')),
  geo_polygon JSONB,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  radius_m NUMERIC,
  buffer_m NUMERIC NOT NULL DEFAULT 150
    CHECK (buffer_m >= 100 AND buffer_m <= 300),
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_site_boundaries_geom_check CHECK (
    (geometry_type = 'radius'
      AND center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_m IS NOT NULL AND radius_m > 0)
    OR
    (geometry_type = 'polygon' AND geo_polygon IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS project_site_boundaries_one_active
  ON public.project_site_boundaries(project_id)
  WHERE is_deleted = false AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_project_site_boundaries_project
  ON public.project_site_boundaries(project_id)
  WHERE is_deleted = false AND is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_site_boundaries TO authenticated;
GRANT ALL ON public.project_site_boundaries TO service_role;

ALTER TABLE public.project_site_boundaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members view project_site_boundaries" ON public.project_site_boundaries;
CREATE POLICY "members view project_site_boundaries" ON public.project_site_boundaries
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_site_boundaries.project_id AND pm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admins manage project_site_boundaries" ON public.project_site_boundaries;
CREATE POLICY "admins manage project_site_boundaries" ON public.project_site_boundaries
  FOR ALL TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_site_boundaries.project_id
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
      WHERE pm.project_id = project_site_boundaries.project_id
        AND pm.user_id = auth.uid()
        AND (
          COALESCE(pm.role_new::text, '') IN ('project_admin', 'safety_manager')
          OR pm.position_new IN ('SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'SUPERVISOR')
        )
    )
  );

DROP TRIGGER IF EXISTS trg_project_site_boundaries_updated ON public.project_site_boundaries;
CREATE TRIGGER trg_project_site_boundaries_updated
  BEFORE UPDATE ON public.project_site_boundaries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.project_site_boundaries IS
  '현장 테두리(다각형/원). 출퇴근은 도형 안 또는 buffer_m(100–300) 이내. 위험구역이 아님.';
