DROP POLICY IF EXISTS permit_tpl_insert_master ON public.permit_form_templates;
DROP POLICY IF EXISTS permit_tpl_update_master ON public.permit_form_templates;
DROP POLICY IF EXISTS permit_tpl_delete_master ON public.permit_form_templates;

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