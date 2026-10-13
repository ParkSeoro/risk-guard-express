-- 1) Feedback inbox title: assessment_run_feedback.entity_id is the assessment run.
-- 2) TBM participation SELECT matches session company visibility (SM/소장 서명 열람).
-- 3) TBM session photos (실시 사진).

ALTER TABLE public.tbm_sessions
  ADD COLUMN IF NOT EXISTS photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.tbm_sessions.photo_urls IS
  'TBM 실시 현장 사진 URL 배열 (attachments 버킷). 최대 3장.';

DROP FUNCTION IF EXISTS public.get_my_pending_entity_approvals();
CREATE FUNCTION public.get_my_pending_entity_approvals()
RETURNS TABLE(
  approval_id uuid,
  entity_type text,
  entity_id uuid,
  project_id uuid,
  step text,
  step_order integer,
  step_position text,
  created_at timestamp with time zone,
  entity_title text,
  entity_date date,
  company_name text,
  personnel_count integer,
  approval_version integer,
  resubmit_count integer,
  submitted_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
  SELECT a.id, a.entity_type, a.entity_id, a.project_id,
         a.step, a.step_order, a.position AS step_position, a.created_at,
         CASE
           WHEN a.entity_type='work_plan' THEN wp.title
           WHEN a.entity_type='work_permit' THEN COALESCE(NULLIF(per.work_name,''), per.work_description, '작업허가서')
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN ar.period_label
           ELSE '' END AS entity_title,
         CASE
           WHEN a.entity_type='work_plan' THEN wp.start_date
           WHEN a.entity_type='work_permit' THEN per.permit_date
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN ar.start_date
           ELSE NULL END AS entity_date,
         CASE
           WHEN a.entity_type='work_permit' THEN COALESCE(NULLIF(per.contractor_company,''), a.company_name)
           WHEN a.entity_type='work_plan' THEN COALESCE(a.company_name, '')
           ELSE COALESCE(a.company_name, '')
         END AS company_name,
         CASE WHEN a.entity_type='work_permit' THEN per.personnel_count ELSE NULL END AS personnel_count,
         a.approval_version,
         GREATEST(COALESCE(a.approval_version, 1) - 1, 0) AS resubmit_count,
         CASE WHEN a.entity_type='work_permit' THEN per.submitted_at ELSE NULL END AS submitted_at
    FROM public.approvals a
    LEFT JOIN public.work_plans      wp  ON a.entity_type='work_plan'      AND wp.id  = a.entity_id
    LEFT JOIN public.work_permits    per ON a.entity_type='work_permit'    AND per.id = a.entity_id
    LEFT JOIN public.assessment_runs ar  ON a.entity_type IN ('assessment_run', 'assessment_run_feedback')
                                        AND ar.id = a.entity_id
   WHERE a.status='진행중' AND a.entity_type IS NOT NULL
     AND public.account_is_active(auth.uid())
     AND (a.approver_id = auth.uid()
          OR (a.approver_id IS NULL AND public.is_project_admin(auth.uid(), a.project_id)))
     AND NOT public.approval_entity_is_deleted(a.entity_type, a.entity_id)
   ORDER BY
     CASE WHEN lower(COALESCE(a.position,'')) = 'closure_sm' THEN 0 ELSE 1 END,
     a.created_at DESC;
$body$;

REVOKE ALL ON FUNCTION public.get_my_pending_entity_approvals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() TO authenticated, service_role;

DROP POLICY IF EXISTS "Company-scoped admins can view tbm_participations" ON public.tbm_participations;
DROP POLICY IF EXISTS "Admins can view tbm_participations" ON public.tbm_participations;
DROP POLICY IF EXISTS "Members can view tbm_participations" ON public.tbm_participations;

-- Same visibility as tbm_sessions SELECT: project member + company tree (발주처 SM 전체, 시공사 자사+하위).
CREATE POLICY "Members can view tbm_participations"
ON public.tbm_participations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tbm_sessions s
    WHERE s.id = tbm_participations.tbm_session_id
      AND public.is_project_member(auth.uid(), s.project_id)
      AND public.can_access_company_data(auth.uid(), s.project_id, s.company_id)
  )
);
