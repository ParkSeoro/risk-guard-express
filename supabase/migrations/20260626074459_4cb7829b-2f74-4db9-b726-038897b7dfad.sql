-- Drop FK to master_departments so department_assignees can reference company_departments
ALTER TABLE public.department_assignees
  DROP CONSTRAINT IF EXISTS department_assignees_department_id_fkey;

-- Add a soft FK pointing to company_departments instead. Use ON DELETE CASCADE so removing a
-- company department cleans up stale mappings. Existing rows that still reference legacy
-- master_departments IDs will be cleaned up below.
ALTER TABLE public.department_assignees
  ADD CONSTRAINT department_assignees_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES public.company_departments(id) ON DELETE CASCADE
    NOT VALID;

-- Remove orphan mapping rows whose department_id no longer matches any company_departments row.
DELETE FROM public.department_assignees da
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_departments cd WHERE cd.id = da.department_id
);

-- Now validate the constraint against the cleaned rows.
ALTER TABLE public.department_assignees
  VALIDATE CONSTRAINT department_assignees_department_id_fkey;