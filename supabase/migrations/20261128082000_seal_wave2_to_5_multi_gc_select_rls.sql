-- Seal 11 multi-GC SELECT RLS policies across Wave 2-5 tables so GC-A cannot read GC-B rows
-- while preserving access for master, owner/client safety viewer, own company tree, and legacy company_id IS NULL rows.

ALTER POLICY "chem_select" ON public.chemicals
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "cup_select" ON public.chemical_usage_plans
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "csp_select" ON public.confined_space_permits
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "Members view drills" ON public.emergency_drills
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "hs_select" ON public.hazard_surveys
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "mss_select" ON public.musculoskeletal_surveys
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "appt_select" ON public.safety_appointments
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "safety_council_records_select" ON public.safety_council_records
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "sht_select" ON public.special_health_targets
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "edu_select" ON public.worker_education_records
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));

ALTER POLICY "wpa_select_project_members" ON public.work_plan_attachments
  USING (public.is_master(auth.uid()) OR (public.is_project_member(auth.uid(), project_id) AND public.can_read_company_data(auth.uid(), project_id, company_id)));
