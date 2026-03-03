
-- 1. Add gc_company_id to projects (references companies)
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS gc_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- 2. Add company_id to project_members (links member to a company within the project)
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- 3. Add target_company_ids array to assessment_runs
ALTER TABLE public.assessment_runs ADD COLUMN IF NOT EXISTS target_company_ids uuid[] DEFAULT ARRAY[]::uuid[];
