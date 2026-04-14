
-- Add location columns to projects
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS site_address text DEFAULT '',
ADD COLUMN IF NOT EXISTS site_lat double precision DEFAULT NULL,
ADD COLUMN IF NOT EXISTS site_lng double precision DEFAULT NULL;

-- Weather cache table
CREATE TABLE public.weather_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cache_type text NOT NULL DEFAULT 'current',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_weather_cache_project ON public.weather_cache(project_id, cache_type);

ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view weather cache"
ON public.weather_cache FOR SELECT
TO authenticated
USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Authenticated can insert weather cache"
ON public.weather_cache FOR INSERT
TO authenticated
WITH CHECK (is_project_member(auth.uid(), project_id));

CREATE POLICY "Authenticated can update weather cache"
ON public.weather_cache FOR UPDATE
TO authenticated
USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Authenticated can delete weather cache"
ON public.weather_cache FOR DELETE
TO authenticated
USING (is_project_member(auth.uid(), project_id));
