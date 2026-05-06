DROP POLICY IF EXISTS "Anyone can view assignees" ON public.master_assignees;
CREATE POLICY "Admins can view assignees"
ON public.master_assignees FOR SELECT TO authenticated
USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
CREATE POLICY "Users can insert own notifications or admins"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id OR is_admin(auth.uid()));