-- Company-scoped permit display templates (replaces project-only scoping for form skins).
-- Does not touch work_permits approval / form_data.

ALTER TABLE public.permit_form_templates
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_permit_form_templates_company_type
  ON public.permit_form_templates (company_id, permit_type, is_default)
  WHERE is_active AND NOT is_deleted AND company_id IS NOT NULL;

COMMENT ON COLUMN public.permit_form_templates.company_id IS
  'Owning company for display template (labels/hide). Null = legacy/global. Independent of approval rules.';

-- SELECT: global (company_id & project_id null), master, project member, or same-company member
DROP POLICY IF EXISTS permit_tpl_select_scoped ON public.permit_form_templates;

CREATE POLICY permit_tpl_select_scoped
  ON public.permit_form_templates
  FOR SELECT
  TO authenticated
  USING (
    is_deleted = false
    AND (
      public.is_master(auth.uid())
      OR (company_id IS NULL AND project_id IS NULL)
      OR (
        project_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = permit_form_templates.project_id
            AND pm.user_id = auth.uid()
        )
      )
      OR (
        company_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.user_id = auth.uid()
            AND pm.company_id = permit_form_templates.company_id
        )
      )
      OR (
        company_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.project_members pm
          JOIN public.projects p ON p.id = pm.project_id
          WHERE pm.user_id = auth.uid()
            AND (
              p.gc_company_id = permit_form_templates.company_id
              OR permit_form_templates.company_id = ANY (COALESCE(p.gc_company_ids, '{}'::uuid[]))
            )
        )
      )
    )
  );
