ALTER TABLE public.work_permits
ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE public.work_permits wp
SET company_id = c.id
FROM public.companies c
WHERE wp.company_id IS NULL
  AND wp.contractor_company IS NOT NULL
  AND wp.contractor_company <> ''
  AND c.name = wp.contractor_company;

CREATE INDEX IF NOT EXISTS idx_work_permits_company_id
ON public.work_permits(company_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_permits_company_id_fkey'
  ) THEN
    ALTER TABLE public.work_permits
    ADD CONSTRAINT work_permits_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END $$;