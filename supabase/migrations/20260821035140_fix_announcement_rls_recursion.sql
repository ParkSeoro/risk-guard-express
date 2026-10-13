-- Fix: infinite recursion between project_announcements ↔ recipients/acks RLS.
-- announcements SELECT joined recipients; recipients SELECT joined announcements.

DROP POLICY IF EXISTS "announcements_select" ON public.project_announcements;
CREATE POLICY "announcements_select"
  ON public.project_announcements FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  );

CREATE OR REPLACE FUNCTION public.announcement_project_id(_announcement_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT project_id FROM public.project_announcements WHERE id = _announcement_id;
$$;

REVOKE ALL ON FUNCTION public.announcement_project_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_project_id(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "announcement_recipients_select" ON public.project_announcement_recipients;
CREATE POLICY "announcement_recipients_select"
  ON public.project_announcement_recipients FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), public.announcement_project_id(announcement_id))
  );

DROP POLICY IF EXISTS "announcement_acks_select" ON public.project_announcement_acks;
CREATE POLICY "announcement_acks_select"
  ON public.project_announcement_acks FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), public.announcement_project_id(announcement_id))
  );
