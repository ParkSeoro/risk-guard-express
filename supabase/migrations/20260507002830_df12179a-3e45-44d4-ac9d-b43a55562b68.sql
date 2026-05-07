CREATE TABLE public.manual_inquiries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT,
  contact TEXT,
  message TEXT NOT NULL,
  page_url TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.manual_inquiries ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous) can submit
CREATE POLICY "Anyone can submit inquiries"
ON public.manual_inquiries
FOR INSERT
WITH CHECK (
  length(message) BETWEEN 1 AND 2000
  AND length(category) BETWEEN 1 AND 50
  AND (name IS NULL OR length(name) <= 100)
  AND (contact IS NULL OR length(contact) <= 200)
);

-- Only masters can read/manage
CREATE POLICY "Masters can view inquiries"
ON public.manual_inquiries
FOR SELECT
USING (public.has_role(auth.uid(), 'master'));

CREATE POLICY "Masters can update inquiries"
ON public.manual_inquiries
FOR UPDATE
USING (public.has_role(auth.uid(), 'master'));

CREATE POLICY "Masters can delete inquiries"
ON public.manual_inquiries
FOR DELETE
USING (public.has_role(auth.uid(), 'master'));