CREATE TABLE public.incident_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  reporter_id uuid,
  reporter_name text NOT NULL DEFAULT '',
  incident_type text NOT NULL DEFAULT 'near_miss',
  severity text NOT NULL DEFAULT 'low',
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  location text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  photos text[] NOT NULL DEFAULT ARRAY[]::text[],
  gps_lat double precision,
  gps_lng double precision,
  status text NOT NULL DEFAULT 'open',
  review_note text NOT NULL DEFAULT '',
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_incident_reports_project ON public.incident_reports(project_id);
CREATE INDEX idx_incident_reports_status ON public.incident_reports(status);

ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view incident reports"
  ON public.incident_reports FOR SELECT TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Members can insert incident reports"
  ON public.incident_reports FOR INSERT TO authenticated
  WITH CHECK (is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can update incident reports"
  ON public.incident_reports FOR UPDATE TO authenticated
  USING (
    is_admin(auth.uid())
    OR get_project_role(auth.uid(), project_id)::text IN ('master','project_admin','safety_manager')
    OR reporter_id = auth.uid()
  );

CREATE POLICY "Admins can delete incident reports"
  ON public.incident_reports FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

CREATE TRIGGER update_incident_reports_updated_at
  BEFORE UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();