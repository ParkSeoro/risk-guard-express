ALTER TABLE public.permit_form_templates
  ADD COLUMN IF NOT EXISTS grid_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS input_cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_xlsx_url text;