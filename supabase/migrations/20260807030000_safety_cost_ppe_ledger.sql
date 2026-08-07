-- 산안비 보호구 지급대장 (디지털)
-- 실무: 구매 증빙 + 수령자 서명 필수

CREATE TABLE IF NOT EXISTS public.safety_cost_ppe_ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  construction_id uuid NOT NULL REFERENCES public.safety_cost_constructions(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.safety_cost_monthly_reports(id) ON DELETE CASCADE,
  site_label text NOT NULL DEFAULT '',
  safety_manager_name text NOT NULL DEFAULT '',
  item_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  UNIQUE (report_id)
);

CREATE TABLE IF NOT EXISTS public.safety_cost_ppe_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id uuid NOT NULL REFERENCES public.safety_cost_ppe_ledgers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  issued_at date NOT NULL DEFAULT CURRENT_DATE,
  worker_name text NOT NULL DEFAULT '',
  worker_id uuid,
  item_name text NOT NULL DEFAULT '',
  signature_data text NOT NULL DEFAULT '',
  signed_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ppe_ledger_report ON public.safety_cost_ppe_ledgers(report_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_ppe_ledger_entries_ledger ON public.safety_cost_ppe_ledger_entries(ledger_id) WHERE is_deleted = false;

ALTER TABLE public.safety_cost_ppe_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_cost_ppe_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ppe_ledgers_select" ON public.safety_cost_ppe_ledgers;
CREATE POLICY "ppe_ledgers_select" ON public.safety_cost_ppe_ledgers
  FOR SELECT TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));

DROP POLICY IF EXISTS "ppe_ledgers_insert" ON public.safety_cost_ppe_ledgers;
CREATE POLICY "ppe_ledgers_insert" ON public.safety_cost_ppe_ledgers
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

DROP POLICY IF EXISTS "ppe_ledgers_update" ON public.safety_cost_ppe_ledgers;
CREATE POLICY "ppe_ledgers_update" ON public.safety_cost_ppe_ledgers
  FOR UPDATE TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true))
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

DROP POLICY IF EXISTS "ppe_ledgers_delete" ON public.safety_cost_ppe_ledgers;
CREATE POLICY "ppe_ledgers_delete" ON public.safety_cost_ppe_ledgers
  FOR DELETE TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

DROP POLICY IF EXISTS "ppe_entries_select" ON public.safety_cost_ppe_ledger_entries;
CREATE POLICY "ppe_entries_select" ON public.safety_cost_ppe_ledger_entries
  FOR SELECT TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));

DROP POLICY IF EXISTS "ppe_entries_insert" ON public.safety_cost_ppe_ledger_entries;
CREATE POLICY "ppe_entries_insert" ON public.safety_cost_ppe_ledger_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

DROP POLICY IF EXISTS "ppe_entries_update" ON public.safety_cost_ppe_ledger_entries;
CREATE POLICY "ppe_entries_update" ON public.safety_cost_ppe_ledger_entries
  FOR UPDATE TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true))
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

DROP POLICY IF EXISTS "ppe_entries_delete" ON public.safety_cost_ppe_ledger_entries;
CREATE POLICY "ppe_entries_delete" ON public.safety_cost_ppe_ledger_entries
  FOR DELETE TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

-- 증빙 파일에 비목 코드 저장 (보고서 단위 업로드 지원)
ALTER TABLE public.safety_cost_evidence_files
  ADD COLUMN IF NOT EXISTS category_code text NOT NULL DEFAULT '';

COMMENT ON TABLE public.safety_cost_ppe_ledgers IS
  'Safety-cost PPE issuance ledger header (one per monthly report).';
COMMENT ON TABLE public.safety_cost_ppe_ledger_entries IS
  'PPE issuance rows with worker receipt signature.';
