-- Browseable field announcements for mobile home (acked + pending).
-- Pending-only list_my_pending_announcements stays for ack banners/modals.

CREATE OR REPLACE FUNCTION public.list_my_field_announcements(
  _project_id uuid DEFAULT NULL,
  _limit integer DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  title text,
  body text,
  require_ack boolean,
  published_at timestamptz,
  expires_at timestamptz,
  acked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.project_id,
    a.title,
    a.body,
    a.require_ack,
    a.published_at,
    a.expires_at,
    k.acked_at
  FROM public.project_announcements a
  JOIN public.project_announcement_recipients r
    ON r.announcement_id = a.id AND r.user_id = auth.uid()
  LEFT JOIN public.project_announcement_acks k
    ON k.announcement_id = a.id AND k.user_id = auth.uid()
  WHERE a.is_withdrawn = false
    AND a.published_at IS NOT NULL
    AND (_project_id IS NULL OR a.project_id = _project_id)
    AND (a.expires_at IS NULL OR a.expires_at > now())
  ORDER BY a.published_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 30), 100));
$$;

REVOKE ALL ON FUNCTION public.list_my_field_announcements(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_field_announcements(uuid, integer) TO authenticated, service_role;
