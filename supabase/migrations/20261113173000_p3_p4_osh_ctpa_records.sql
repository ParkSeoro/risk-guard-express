-- P3-a: 산안법 §64·§75 협의체/합동점검/노사협의체
CREATE TABLE IF NOT EXISTS public.safety_council_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  meeting_type text NOT NULL CHECK (meeting_type IN ('safety_council', 'joint_inspection', 'labor_council')),
  held_at date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL,
  attendees_text text,
  agenda text,
  decisions text,
  follow_up_action text,
  linked_action_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_council_records_proj
  ON public.safety_council_records (project_id, held_at DESC)
  WHERE is_deleted = false;

ALTER TABLE public.safety_council_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS safety_council_records_select ON public.safety_council_records;
CREATE POLICY safety_council_records_select ON public.safety_council_records
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS safety_council_records_insert ON public.safety_council_records;
CREATE POLICY safety_council_records_insert ON public.safety_council_records
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS safety_council_records_update ON public.safety_council_records;
CREATE POLICY safety_council_records_update ON public.safety_council_records
  FOR UPDATE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id))
  WITH CHECK (public.is_project_member(auth.uid(), project_id));

-- P3-b: 산안법 §67 발주자 안전보건대장
CREATE TABLE IF NOT EXISTS public.client_safety_ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('basic', 'design', 'construction')),
  title text NOT NULL,
  checklist_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary_notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'confirmed')),
  confirmed_by_name text,
  confirmed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_safety_ledgers_proj
  ON public.client_safety_ledgers (project_id, stage)
  WHERE is_deleted = false;

ALTER TABLE public.client_safety_ledgers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_safety_ledgers_select ON public.client_safety_ledgers;
CREATE POLICY client_safety_ledgers_select ON public.client_safety_ledgers
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS client_safety_ledgers_insert ON public.client_safety_ledgers;
CREATE POLICY client_safety_ledgers_insert ON public.client_safety_ledgers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS client_safety_ledgers_update ON public.client_safety_ledgers;
CREATE POLICY client_safety_ledgers_update ON public.client_safety_ledgers
  FOR UPDATE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id))
  WITH CHECK (public.is_project_member(auth.uid(), project_id));

-- P4: 건진법 (§62, §62의2, §67) 공사관리 트랙
CREATE TABLE IF NOT EXISTS public.ctpa_compliance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  record_type text NOT NULL CHECK (record_type IN ('safety_mgmt_plan', 'small_safety_plan', 'periodic_inspection', 'dfs_temp_structure', 'csi_accident_draft')),
  title text NOT NULL,
  target_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'submitted')),
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctpa_compliance_records_proj
  ON public.ctpa_compliance_records (project_id, record_type)
  WHERE is_deleted = false;

ALTER TABLE public.ctpa_compliance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ctpa_compliance_records_select ON public.ctpa_compliance_records;
CREATE POLICY ctpa_compliance_records_select ON public.ctpa_compliance_records
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS ctpa_compliance_records_insert ON public.ctpa_compliance_records;
CREATE POLICY ctpa_compliance_records_insert ON public.ctpa_compliance_records
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id));

DROP POLICY IF EXISTS ctpa_compliance_records_update ON public.ctpa_compliance_records;
CREATE POLICY ctpa_compliance_records_update ON public.ctpa_compliance_records
  FOR UPDATE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id))
  WITH CHECK (public.is_project_member(auth.uid(), project_id));
