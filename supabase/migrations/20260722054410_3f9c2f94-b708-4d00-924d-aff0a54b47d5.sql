
DROP POLICY IF EXISTS "Non-viewers can insert risk items" ON public.risk_items;
DROP POLICY IF EXISTS "Non-viewers can update risk items" ON public.risk_items;
DROP POLICY IF EXISTS "Admins can delete risk items" ON public.risk_items;

CREATE POLICY "Non-viewers can insert risk items"
ON public.risk_items FOR INSERT TO authenticated
WITH CHECK (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager','site_manager','supervisor']::project_role[]));

CREATE POLICY "Non-viewers can update risk items"
ON public.risk_items FOR UPDATE TO authenticated
USING (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager','site_manager','supervisor']::project_role[]))
WITH CHECK (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager','site_manager','supervisor']::project_role[]));

CREATE POLICY "Admins can delete risk items"
ON public.risk_items FOR DELETE TO authenticated
USING (public.is_project_admin(auth.uid(), project_id));
