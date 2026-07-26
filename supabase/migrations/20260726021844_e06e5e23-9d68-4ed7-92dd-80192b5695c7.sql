-- Restrict risk_knowledge_base SELECT to masters and users who are members of at least one project.
-- Previously any authenticated user could read, leaking proprietary content to accounts with no project relationship.
DROP POLICY IF EXISTS "kb select all auth" ON public.risk_knowledge_base;

CREATE POLICY "kb select project members or master"
ON public.risk_knowledge_base
FOR SELECT
TO authenticated
USING (
  is_active = true
  AND (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
    )
  )
);