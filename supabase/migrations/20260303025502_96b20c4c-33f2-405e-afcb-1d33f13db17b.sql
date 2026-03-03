
-- Add responsible_department_id and assignee_user_id to risk_items
ALTER TABLE public.risk_items
  ADD COLUMN IF NOT EXISTS responsible_department_id uuid REFERENCES public.master_departments(id),
  ADD COLUMN IF NOT EXISTS assignee_user_id uuid;
