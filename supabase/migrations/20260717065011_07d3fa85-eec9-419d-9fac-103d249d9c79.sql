DROP POLICY IF EXISTS permit_tpl_update_master ON public.permit_form_templates;
CREATE POLICY permit_tpl_update_master ON public.permit_form_templates
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'::global_role))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'::global_role));