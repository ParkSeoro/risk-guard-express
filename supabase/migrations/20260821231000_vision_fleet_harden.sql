-- Harden Vision Fleet: pending QR rows and kit blobs are not world-readable.
-- Applied after 20260821220000_vision_fleet.

CREATE OR REPLACE FUNCTION public.is_vision_operator(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT public.is_master(_user_id)
    OR EXISTS (
      SELECT 1
        FROM public.project_members pm
       WHERE pm.user_id = _user_id
         AND pm.project_id = _project_id
         AND COALESCE(pm.role_new::text, '') IN ('project_admin', 'safety_manager', 'site_manager')
    );
$$;

REVOKE ALL ON FUNCTION public.is_vision_operator(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_vision_operator(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.vision_device_authorizations
  ADD COLUMN IF NOT EXISTS one_time_access_token text;

DROP POLICY IF EXISTS vision_authz_select ON public.vision_device_authorizations;
REVOKE SELECT ON public.vision_device_authorizations FROM authenticated;

DROP POLICY IF EXISTS vision_kits_select ON public.vision_provisioning_kits;
CREATE POLICY vision_kits_select ON public.vision_provisioning_kits FOR SELECT TO authenticated
  USING (public.is_vision_operator(auth.uid(), project_id));

DROP POLICY IF EXISTS vision_events_update ON public.vision_safety_events;
CREATE POLICY vision_events_update ON public.vision_safety_events FOR UPDATE TO authenticated
  USING (public.is_vision_operator(auth.uid(), project_id))
  WITH CHECK (public.is_vision_operator(auth.uid(), project_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_vision_kits_token_hash
  ON public.vision_provisioning_kits (bootstrap_token_hash);
