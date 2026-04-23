DROP POLICY IF EXISTS "Safety cost monthly reports delete admin access" ON public.safety_cost_monthly_reports;

CREATE POLICY "Safety cost monthly reports delete draft access"
ON public.safety_cost_monthly_reports
FOR DELETE TO authenticated
USING (
  status <> 'approved'
  AND public.can_access_safety_cost(auth.uid(), project_id, company_id, true)
);