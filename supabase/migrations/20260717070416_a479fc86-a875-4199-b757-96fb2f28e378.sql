GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_form_templates TO authenticated;
GRANT ALL ON public.permit_form_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_form_template_versions TO authenticated;
GRANT ALL ON public.permit_form_template_versions TO service_role;

DROP POLICY IF EXISTS permit_tpl_select_all ON public.permit_form_templates;
DROP POLICY IF EXISTS permit_tpl_select_active_authenticated ON public.permit_form_templates;
DROP POLICY IF EXISTS permit_tpl_select_master_all ON public.permit_form_templates;
DROP POLICY IF EXISTS permit_tpl_insert_master ON public.permit_form_templates;
DROP POLICY IF EXISTS permit_tpl_update_master ON public.permit_form_templates;
DROP POLICY IF EXISTS permit_tpl_delete_master ON public.permit_form_templates;

CREATE POLICY permit_tpl_select_active_authenticated
ON public.permit_form_templates
FOR SELECT
TO authenticated
USING (is_deleted = false);

CREATE POLICY permit_tpl_select_master_all
ON public.permit_form_templates
FOR SELECT
TO authenticated
USING (public.is_master(auth.uid()));

CREATE POLICY permit_tpl_insert_master
ON public.permit_form_templates
FOR INSERT
TO authenticated
WITH CHECK (public.is_master(auth.uid()));

CREATE POLICY permit_tpl_update_master
ON public.permit_form_templates
FOR UPDATE
TO authenticated
USING (public.is_master(auth.uid()))
WITH CHECK (public.is_master(auth.uid()));

CREATE POLICY permit_tpl_delete_master
ON public.permit_form_templates
FOR DELETE
TO authenticated
USING (public.is_master(auth.uid()));