
CREATE TABLE public.ai_risk_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_name TEXT NOT NULL,
  equipment TEXT DEFAULT '',
  work_description TEXT DEFAULT '',
  work_location TEXT DEFAULT '일반',
  work_environment TEXT[] DEFAULT ARRAY[]::text[],
  cache_key TEXT NOT NULL,
  generated_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  hit_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

CREATE UNIQUE INDEX idx_ai_risk_cache_key ON public.ai_risk_cache (cache_key);
CREATE INDEX idx_ai_risk_cache_process ON public.ai_risk_cache (process_name);

ALTER TABLE public.ai_risk_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view cache" ON public.ai_risk_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert cache" ON public.ai_risk_cache FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update cache" ON public.ai_risk_cache FOR UPDATE TO authenticated USING (true);
