-- Disk IO: approvals lookup indexes + badge count RPC (same filters as inbox).
-- GPS coalesce already lives in track-location; do not change it here.

CREATE INDEX IF NOT EXISTS idx_approvals_status_approver
  ON public.approvals (status, approver_id);

CREATE INDEX IF NOT EXISTS idx_approvals_project_created
  ON public.approvals (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_pending_approver
  ON public.approvals (approver_id)
  WHERE status = '진행중' AND entity_type IS NOT NULL;

CREATE OR REPLACE FUNCTION public.count_my_pending_entity_approvals()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
  SELECT count(*)::integer
    FROM public.approvals a
   WHERE a.status = '진행중' AND a.entity_type IS NOT NULL
     AND public.account_is_active((SELECT auth.uid()))
     AND (
       a.approver_id = (SELECT auth.uid())
       OR (
         a.approver_id IS NULL
         AND public.is_project_admin((SELECT auth.uid()), a.project_id)
       )
     )
     AND NOT public.approval_entity_is_deleted(a.entity_type, a.entity_id)
     AND NOT public.approval_entity_is_voided(a.entity_type, a.entity_id);
$body$;

REVOKE ALL ON FUNCTION public.count_my_pending_entity_approvals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_my_pending_entity_approvals() TO authenticated, service_role;
