-- Grant execute on issue_daily_qr so authenticated users can issue QR codes
GRANT EXECUTE ON FUNCTION public.issue_daily_qr(uuid) TO authenticated;

-- Support multiple GCs (시공사) and subcontractors (협력사) per project
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS gc_company_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sub_company_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill arrays from legacy single column
UPDATE public.projects
   SET gc_company_ids = ARRAY[gc_company_id]
 WHERE gc_company_id IS NOT NULL
   AND (gc_company_ids IS NULL OR array_length(gc_company_ids,1) IS NULL);
