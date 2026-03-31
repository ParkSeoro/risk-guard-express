
-- Add company_id to todo_items for company-level data isolation
ALTER TABLE public.todo_items ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_todo_items_company_id ON public.todo_items(company_id);
CREATE INDEX IF NOT EXISTS idx_work_plans_company_id ON public.work_plans(company_id);
CREATE INDEX IF NOT EXISTS idx_legal_duties_company_id ON public.legal_duties(company_id);
