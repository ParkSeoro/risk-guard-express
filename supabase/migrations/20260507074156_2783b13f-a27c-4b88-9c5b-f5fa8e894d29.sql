
CREATE TABLE public.system_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_score numeric,
  status text NOT NULL DEFAULT 'running',
  scope text NOT NULL DEFAULT 'all',
  summary jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.system_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.system_test_runs(id) ON DELETE CASCADE,
  scenario_key text NOT NULL,
  step_key text NOT NULL,
  pass_fail text NOT NULL,
  duration_ms integer,
  error_location text,
  details jsonb DEFAULT '{}'::jsonb,
  score numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.system_test_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.system_test_runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref_table text NOT NULL,
  ref_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_str_run ON public.system_test_results(run_id);
CREATE INDEX idx_sta_run ON public.system_test_artifacts(run_id);

ALTER TABLE public.system_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_test_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master all str" ON public.system_test_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "master all srr" ON public.system_test_results FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "master all sta" ON public.system_test_artifacts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE OR REPLACE FUNCTION public.qa_impersonate_check(_target_user uuid, _project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _is_master boolean;
  _proj_role text;
  _is_member boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'master'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  _is_master := public.has_role(_target_user, 'master'::app_role);
  _proj_role := public.get_project_role(_target_user, _project_id)::text;
  _is_member := public.is_project_member(_target_user, _project_id);
  RETURN jsonb_build_object(
    'is_master', _is_master,
    'project_role', _proj_role,
    'is_member', _is_member
  );
END;
$$;
