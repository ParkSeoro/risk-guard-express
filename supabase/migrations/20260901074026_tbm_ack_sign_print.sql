-- Daily ack / crew sync could not write tbm_participations (RLS had SELECT+DELETE only).
-- GPS exit discarded the signature pad. Workers could not see their own TBM row.

DROP POLICY IF EXISTS "Managers can insert tbm_participations" ON public.tbm_participations;
CREATE POLICY "Managers can insert tbm_participations"
ON public.tbm_participations
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tbm_sessions s
    WHERE s.id = tbm_participations.tbm_session_id
      AND (
        public.is_master(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.user_id = auth.uid()
            AND pm.project_id = s.project_id
            AND pm.role_new IN (
              'project_admin'::public.project_role,
              'safety_manager'::public.project_role,
              'site_manager'::public.project_role,
              'site_supervisor'::public.project_role,
              'supervisor'::public.project_role
            )
        )
      )
  )
);
