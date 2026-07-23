
ALTER TABLE public.project_companies ADD COLUMN IF NOT EXISTS parent_company_id UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL;

-- Backfill from global companies.parent_company_id where both sides are linked to same project
UPDATE public.project_companies pc
SET parent_company_id = c.parent_company_id
FROM public.companies c
WHERE pc.company_id = c.id
  AND c.parent_company_id IS NOT NULL
  AND pc.parent_company_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.project_companies pc2
    WHERE pc2.project_id = pc.project_id
      AND pc2.company_id = c.parent_company_id
  );
