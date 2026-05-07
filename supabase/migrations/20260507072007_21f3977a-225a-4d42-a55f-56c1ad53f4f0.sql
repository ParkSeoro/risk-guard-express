
-- ai_generation_jobs
CREATE TABLE public.ai_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  run_id UUID,
  created_by UUID NOT NULL,
  process_name TEXT NOT NULL,
  equipment TEXT,
  work_description TEXT,
  work_location TEXT,
  work_environment JSONB DEFAULT '[]'::jsonb,
  target_count INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'queued',
  total_batches INTEGER NOT NULL DEFAULT 0,
  completed_batches INTEGER NOT NULL DEFAULT 0,
  items_generated INTEGER NOT NULL DEFAULT 0,
  quality_score NUMERIC,
  diversity_score NUMERIC,
  duplicate_rate NUMERIC,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_jobs_project ON public.ai_generation_jobs(project_id, created_at DESC);
CREATE INDEX idx_ai_jobs_status ON public.ai_generation_jobs(status);
ALTER TABLE public.ai_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_jobs select members" ON public.ai_generation_jobs
  FOR SELECT USING (public.is_project_member(auth.uid(), project_id) OR public.has_role(auth.uid(),'master'));
CREATE POLICY "ai_jobs insert members" ON public.ai_generation_jobs
  FOR INSERT WITH CHECK (auth.uid() = created_by AND (public.is_project_member(auth.uid(), project_id) OR public.has_role(auth.uid(),'master')));
CREATE POLICY "ai_jobs update master or owner" ON public.ai_generation_jobs
  FOR UPDATE USING (public.has_role(auth.uid(),'master') OR auth.uid() = created_by);
CREATE POLICY "ai_jobs delete master" ON public.ai_generation_jobs
  FOR DELETE USING (public.has_role(auth.uid(),'master'));

CREATE TRIGGER ai_jobs_updated_at BEFORE UPDATE ON public.ai_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ai_generation_logs
CREATE TABLE public.ai_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.ai_generation_jobs(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL DEFAULT 0,
  prompt TEXT,
  raw_response JSONB,
  model TEXT,
  tokens_used INTEGER,
  latency_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_logs_job ON public.ai_generation_logs(job_id, batch_index);
ALTER TABLE public.ai_generation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_logs select master or job owner" ON public.ai_generation_logs
  FOR SELECT USING (
    public.has_role(auth.uid(),'master') OR
    EXISTS (SELECT 1 FROM public.ai_generation_jobs j WHERE j.id = job_id AND (j.created_by = auth.uid() OR public.is_project_member(auth.uid(), j.project_id)))
  );
CREATE POLICY "ai_logs insert any auth" ON public.ai_generation_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ai_generated_items_buffer
CREATE TABLE public.ai_generated_items_buffer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.ai_generation_jobs(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_buffer_job ON public.ai_generated_items_buffer(job_id, batch_index);
ALTER TABLE public.ai_generated_items_buffer ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_buffer select via job" ON public.ai_generated_items_buffer
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.ai_generation_jobs j WHERE j.id = job_id AND (public.is_project_member(auth.uid(), j.project_id) OR public.has_role(auth.uid(),'master')))
  );
CREATE POLICY "ai_buffer insert any auth" ON public.ai_generated_items_buffer
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "ai_buffer delete master" ON public.ai_generated_items_buffer
  FOR DELETE USING (public.has_role(auth.uid(),'master'));

-- risk_user_corrections
CREATE TABLE public.risk_user_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  process_name TEXT,
  field_changed TEXT,
  original JSONB,
  corrected JSONB,
  corrected_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_risk_corrections_project ON public.risk_user_corrections(project_id, process_name);
ALTER TABLE public.risk_user_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corrections select members" ON public.risk_user_corrections
  FOR SELECT USING (public.is_project_member(auth.uid(), project_id) OR public.has_role(auth.uid(),'master'));
CREATE POLICY "corrections insert members" ON public.risk_user_corrections
  FOR INSERT WITH CHECK (auth.uid() = corrected_by AND (public.is_project_member(auth.uid(), project_id) OR public.has_role(auth.uid(),'master')));
CREATE POLICY "corrections delete master" ON public.risk_user_corrections
  FOR DELETE USING (public.has_role(auth.uid(),'master'));

-- risk_knowledge_base
CREATE TABLE public.risk_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  process_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  equipment_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding_summary TEXT,
  legal_reference TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_process_tags ON public.risk_knowledge_base USING GIN(process_tags);
CREATE INDEX idx_kb_equipment_tags ON public.risk_knowledge_base USING GIN(equipment_tags);
CREATE INDEX idx_kb_source ON public.risk_knowledge_base(source_type);
ALTER TABLE public.risk_knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kb select all auth" ON public.risk_knowledge_base
  FOR SELECT USING (auth.uid() IS NOT NULL AND is_active = true);
CREATE POLICY "kb insert master" ON public.risk_knowledge_base
  FOR INSERT WITH CHECK (public.has_role(auth.uid(),'master'));
CREATE POLICY "kb update master" ON public.risk_knowledge_base
  FOR UPDATE USING (public.has_role(auth.uid(),'master'));
CREATE POLICY "kb delete master" ON public.risk_knowledge_base
  FOR DELETE USING (public.has_role(auth.uid(),'master'));

CREATE TRIGGER kb_updated_at BEFORE UPDATE ON public.risk_knowledge_base
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ai_test_runs
CREATE TABLE public.ai_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tested_by UUID NOT NULL,
  test_type TEXT NOT NULL,
  input_params JSONB,
  result JSONB,
  pass_fail TEXT,
  error_location TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_test_runs_user ON public.ai_test_runs(tested_by, created_at DESC);
ALTER TABLE public.ai_test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "test runs master only" ON public.ai_test_runs
  FOR ALL USING (public.has_role(auth.uid(),'master')) WITH CHECK (public.has_role(auth.uid(),'master'));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_generation_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_generated_items_buffer;
ALTER TABLE public.ai_generation_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.ai_generated_items_buffer REPLICA IDENTITY FULL;
