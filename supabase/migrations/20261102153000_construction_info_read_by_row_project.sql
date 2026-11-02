-- Construction rows are per site. companies.project_id is empty on the global master,
-- so read and delete must use this row's project_id with the same company scope as other modules.

DROP POLICY IF EXISTS "Company-scoped view: company_construction_info" ON public.company_construction_info;
CREATE POLICY "Company-scoped view: company_construction_info"
  ON public.company_construction_info
  FOR SELECT
  TO authenticated
  USING (public.can_read_company_data(auth.uid(), project_id, company_id));

DROP POLICY IF EXISTS "Writers can delete construction info" ON public.company_construction_info;
CREATE POLICY "Writers can delete construction info"
  ON public.company_construction_info
  FOR DELETE
  TO authenticated
  USING (public.can_write_company_data(auth.uid(), project_id, company_id));
