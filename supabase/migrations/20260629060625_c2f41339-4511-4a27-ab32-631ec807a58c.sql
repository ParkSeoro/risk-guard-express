
ALTER TABLE public.approval_route_templates
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_approval_route_templates_owner
  ON public.approval_route_templates(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- Allow owners to manage their own personal templates regardless of role
DROP POLICY IF EXISTS "Owners manage own approval route templates" ON public.approval_route_templates;
CREATE POLICY "Owners manage own approval route templates"
  ON public.approval_route_templates
  FOR ALL
  TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
