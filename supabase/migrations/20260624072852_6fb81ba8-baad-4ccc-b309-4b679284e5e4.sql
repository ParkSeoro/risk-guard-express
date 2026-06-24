
-- 1) Extend incident_reports with legal compliance fields
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS is_major boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legal_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS reported_to_authority_at timestamptz,
  ADD COLUMN IF NOT EXISTS authority_report_no text;

-- Auto-set legal_deadline_at = occurred_at + 24h for major incidents
CREATE OR REPLACE FUNCTION public.trg_incident_legal_deadline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.is_major = true OR NEW.severity IN ('high','critical','major','중대') THEN
    NEW.is_major := true;
    IF NEW.legal_deadline_at IS NULL THEN
      NEW.legal_deadline_at := NEW.occurred_at + interval '24 hours';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_incident_legal_deadline ON public.incident_reports;
CREATE TRIGGER trg_incident_legal_deadline
BEFORE INSERT OR UPDATE ON public.incident_reports
FOR EACH ROW EXECUTE FUNCTION public.trg_incident_legal_deadline();

-- 2) Emergency drills table (산안법 §52 비상조치계획)
CREATE TABLE IF NOT EXISTS public.emergency_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  drill_type text NOT NULL DEFAULT 'evacuation', -- evacuation/fire/earthquake/chemical_leak/rescue/first_aid
  title text NOT NULL,
  scenario text NOT NULL DEFAULT '',
  scheduled_date date,
  conducted_date date,
  location text NOT NULL DEFAULT '',
  leader_name text NOT NULL DEFAULT '',
  participants_count int NOT NULL DEFAULT 0,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  issues_found text NOT NULL DEFAULT '',
  improvements text NOT NULL DEFAULT '',
  photos text[] NOT NULL DEFAULT ARRAY[]::text[],
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_due_date date,
  legal_basis text NOT NULL DEFAULT '산업안전보건법 제52조 / 시행규칙 §38 (비상조치계획)',
  status text NOT NULL DEFAULT 'planned', -- planned/done/cancelled
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz, deleted_by uuid, deleted_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_drills TO authenticated;
GRANT ALL ON public.emergency_drills TO service_role;

ALTER TABLE public.emergency_drills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view drills" ON public.emergency_drills
  FOR SELECT TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Safety roles insert drills" ON public.emergency_drills
  FOR INSERT TO authenticated
  WITH CHECK (
    is_master(auth.uid())
    OR has_project_role(auth.uid(), project_id,
        ARRAY['project_admin','safety_manager','site_manager']::project_role[])
  );

CREATE POLICY "Safety roles update drills" ON public.emergency_drills
  FOR UPDATE TO authenticated
  USING (
    is_master(auth.uid())
    OR has_project_role(auth.uid(), project_id,
        ARRAY['project_admin','safety_manager','site_manager']::project_role[])
  );

CREATE POLICY "Admins delete drills" ON public.emergency_drills
  FOR DELETE TO authenticated
  USING (
    is_master(auth.uid())
    OR has_project_role(auth.uid(), project_id,
        ARRAY['project_admin','safety_manager']::project_role[])
  );

CREATE TRIGGER update_emergency_drills_updated_at
BEFORE UPDATE ON public.emergency_drills
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_emergency_drills_project ON public.emergency_drills(project_id);
CREATE INDEX IF NOT EXISTS idx_emergency_drills_status ON public.emergency_drills(status);

-- Auto-generate next_due_date (annual) and todo on completion
CREATE OR REPLACE FUNCTION public.trg_emergency_drill_next_due()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.conducted_date IS NOT NULL AND NEW.next_due_date IS NULL THEN
    NEW.next_due_date := (NEW.conducted_date + interval '1 year')::date;
  END IF;
  IF NEW.conducted_date IS NOT NULL AND NEW.status = 'planned' THEN
    NEW.status := 'done';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emergency_drill_next_due ON public.emergency_drills;
CREATE TRIGGER trg_emergency_drill_next_due
BEFORE INSERT OR UPDATE ON public.emergency_drills
FOR EACH ROW EXECUTE FUNCTION public.trg_emergency_drill_next_due();

-- 3) Extend data integrity check with two new findings
CREATE OR REPLACE FUNCTION public.check_data_integrity(_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _findings jsonb := '[]'::jsonb; _c int;
BEGIN
  IF NOT (public.is_master(auth.uid())
          OR (_project_id IS NOT NULL AND public.is_project_member(auth.uid(), _project_id))) THEN
    RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COUNT(*) INTO _c FROM public.project_members pm
   LEFT JOIN public.profiles p ON p.user_id = pm.user_id
   WHERE p.user_id IS NULL AND (_project_id IS NULL OR pm.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','PM_PROFILE_ORPHAN','severity','high','count',_c,
    'message','project_members rows without matching profile')); END IF;

  SELECT COUNT(*) INTO _c FROM public.workers w
   WHERE w.is_active = true AND w.company_id IS NULL
     AND (_project_id IS NULL OR w.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','WORKER_NO_COMPANY','severity','medium','count',_c,
    'message','active workers without company_id')); END IF;

  SELECT COUNT(*) INTO _c FROM public.worker_entry_logs wel
   WHERE wel.daily_qr_id IS NULL
     AND (wel.entry_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
     AND (_project_id IS NULL OR wel.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','ENTRY_NO_DAILY_QR','severity','low','count',_c,
    'message','today entry logs not linked to a daily QR')); END IF;

  SELECT COUNT(*) INTO _c FROM public.project_members pm
   JOIN public.companies c ON c.id = pm.company_id
   WHERE pm.company IS NOT NULL AND pm.company <> '' AND pm.company <> c.name
     AND (_project_id IS NULL OR pm.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','PM_COMPANY_TEXT_DRIFT','severity','low','count',_c,
    'message','project_members.company text differs from companies.name')); END IF;

  SELECT COUNT(*) INTO _c FROM public.risk_items ri
   WHERE COALESCE(ri.is_deleted,false) = false
     AND (COALESCE(ri.severity,1) * COALESCE(ri.frequency,1)) >= 6
     AND (_project_id IS NULL OR ri.project_id = _project_id)
     AND NOT EXISTS (SELECT 1 FROM public.todo_items td
        WHERE td.source_table = 'risk_items' AND td.source_id = ri.id
          AND COALESCE(td.is_deleted,false) = false);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','HIGH_RISK_NO_TODO','severity','high','count',_c,
    'message','high risk items (>=6) without a follow-up todo')); END IF;

  SELECT COUNT(*) INTO _c FROM public.chemicals ch
   WHERE COALESCE(ch.is_deleted,false) = false
     AND (ch.is_carcinogen = true OR ch.is_reproductive_toxin = true)
     AND (_project_id IS NULL OR ch.project_id = _project_id)
     AND NOT EXISTS (SELECT 1 FROM public.health_checkups hc
        WHERE hc.project_id = ch.project_id
          AND COALESCE(hc.is_deleted,false) = false
          AND hc.type::text ILIKE '%special%');
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','CARCINOGEN_NO_SPECIAL_CHECKUP','severity','high','count',_c,
    'message','carcinogen/repro-toxin MSDS registered but no special health checkup recorded')); END IF;

  SELECT COUNT(*) INTO _c FROM (
    SELECT factor_id, MAX(measured_at) AS last_at, project_id
      FROM public.work_env_measurements
     WHERE COALESCE(is_deleted,false) = false
       AND (_project_id IS NULL OR project_id = _project_id)
     GROUP BY factor_id, project_id) s WHERE s.last_at < now() - INTERVAL '6 months';
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','ENV_MEASUREMENT_OVERDUE','severity','high','count',_c,
    'message','factors with no measurement in 6 months (시행규칙 §202)')); END IF;

  SELECT COUNT(*) INTO _c FROM public.safety_inspection_actions sia
   WHERE sia.status NOT IN ('done','closed')
     AND sia.due_date IS NOT NULL AND sia.due_date < CURRENT_DATE
     AND (_project_id IS NULL OR sia.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','INSPECTION_ACTION_OVERDUE','severity','high','count',_c,
    'message','open inspection actions past due date')); END IF;

  SELECT COUNT(*) INTO _c FROM public.approvals a
   WHERE a.status = '대기' AND a.approver_id IS NULL
     AND (_project_id IS NULL OR a.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','APPROVAL_NO_APPROVER','severity','medium','count',_c,
    'message','pending approvals with no approver assigned')); END IF;

  -- NEW: major incident not yet reported within 24h
  SELECT COUNT(*) INTO _c FROM public.incident_reports ir
   WHERE COALESCE(ir.is_deleted,false) = false
     AND ir.is_major = true
     AND ir.reported_to_authority_at IS NULL
     AND ir.legal_deadline_at IS NOT NULL
     AND ir.legal_deadline_at < now() + interval '6 hours'
     AND (_project_id IS NULL OR ir.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','MAJOR_INCIDENT_OVERDUE','severity','critical','count',_c,
    'message','중대재해 24시간 보고 시한 임박/초과 (산안법 §57)')); END IF;

  -- NEW: project without an emergency drill conducted in last 12 months
  SELECT COUNT(*) INTO _c FROM public.projects p
   WHERE COALESCE(p.is_deleted,false) = false
     AND (_project_id IS NULL OR p.id = _project_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.emergency_drills ed
        WHERE ed.project_id = p.id
          AND COALESCE(ed.is_deleted,false) = false
          AND ed.conducted_date IS NOT NULL
          AND ed.conducted_date >= (CURRENT_DATE - interval '1 year')
     );
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','EMERGENCY_DRILL_MISSING','severity','high','count',_c,
    'message','최근 1년 내 비상대피훈련 미실시 (산안법 §52)')); END IF;

  RETURN jsonb_build_object(
    'checked_at', now(), 'project_id', _project_id,
    'findings', _findings, 'total_findings', jsonb_array_length(_findings));
END; $function$;
