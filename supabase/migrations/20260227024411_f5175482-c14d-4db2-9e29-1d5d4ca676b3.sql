
-- Allow masters to update any profile (for user management: status, company, position changes)
CREATE POLICY "Masters can update any profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'master'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));
