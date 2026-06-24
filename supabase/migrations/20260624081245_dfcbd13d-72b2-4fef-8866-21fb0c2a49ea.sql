
REVOKE EXECUTE ON FUNCTION public.validate_safety_cost_report(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.acknowledge_assessment_notice(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.derive_permit_from_work_plan(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.derive_tbm_from_work_plan(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_data_integrity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_safety_cost_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_assessment_notice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.derive_permit_from_work_plan(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.derive_tbm_from_work_plan(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_data_integrity(uuid) TO authenticated;
