-- Web client persist of vision_cameras.company_id.
-- Authenticated had SELECT only, so 현장 공용 → 시공사 저장이 0건으로 끝났다.

GRANT UPDATE (company_id) ON public.vision_cameras TO authenticated;

DROP POLICY IF EXISTS vision_cameras_update ON public.vision_cameras;
CREATE POLICY vision_cameras_update ON public.vision_cameras
  FOR UPDATE TO authenticated
  USING (public.is_vision_operator(auth.uid(), project_id))
  WITH CHECK (public.is_vision_operator(auth.uid(), project_id));
