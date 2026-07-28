-- Optional: backfill site_supervisor role from SITE_SUPERVISOR position.
-- Safe after 20260728053000 commits the new enum value.
-- Uses text compare so this still no-ops cleanly if no matching rows exist.

UPDATE public.project_members
SET role_new = 'site_supervisor'::public.project_role
WHERE position_new::text = 'SITE_SUPERVISOR'
  AND role_new::text = 'supervisor';
