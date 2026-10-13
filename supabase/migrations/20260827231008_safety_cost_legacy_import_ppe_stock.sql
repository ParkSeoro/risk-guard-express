-- 산안비: 과거 승인본 이관(추출) + 보호구 수불/재고
-- 이관은 draft → 검수 → commit. 보호구는 구매(입고)와 지급(출고) 분리.

-- ─────────────────────────────────────────────
-- 1) 이관 배치
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_cost_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  construction_id uuid REFERENCES public.safety_cost_constructions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewing', 'committed', 'cancelled')),
  source_file_name text NOT NULL DEFAULT '',
  source_file_path text NOT NULL DEFAULT '',
  source_file_url text NOT NULL DEFAULT '',
  source_mime_type text NOT NULL DEFAULT '',
  source_file_hash text NOT NULL DEFAULT '',
  draft_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_notes text NOT NULL DEFAULT '',
  committed_at timestamptz,
  committed_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sc_import_batches_construction
  ON public.safety_cost_import_batches(construction_id, created_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_sc_import_batches_project
  ON public.safety_cost_import_batches(project_id, company_id, status)
  WHERE is_deleted = false;

ALTER TABLE public.safety_cost_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc_import_batches_select" ON public.safety_cost_import_batches;
CREATE POLICY "sc_import_batches_select" ON public.safety_cost_import_batches
  FOR SELECT TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));

DROP POLICY IF EXISTS "sc_import_batches_insert" ON public.safety_cost_import_batches;
CREATE POLICY "sc_import_batches_insert" ON public.safety_cost_import_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

DROP POLICY IF EXISTS "sc_import_batches_update" ON public.safety_cost_import_batches;
CREATE POLICY "sc_import_batches_update" ON public.safety_cost_import_batches
  FOR UPDATE TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true))
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

DROP POLICY IF EXISTS "sc_import_batches_delete" ON public.safety_cost_import_batches;
CREATE POLICY "sc_import_batches_delete" ON public.safety_cost_import_batches
  FOR DELETE TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE TRIGGER update_safety_cost_import_batches_updated_at
BEFORE UPDATE ON public.safety_cost_import_batches
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 월보 출처 추적
ALTER TABLE public.safety_cost_monthly_reports
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.safety_cost_monthly_reports
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.safety_cost_import_batches(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.safety_cost_monthly_reports.source IS
  'manual | legacy_import — 이관 확정분은 legacy_import';

-- ─────────────────────────────────────────────
-- 2) 보호구 SKU + 수불(입출고) 이동
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_cost_ppe_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  construction_id uuid NOT NULL REFERENCES public.safety_cost_constructions(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  item_name text NOT NULL DEFAULT '',
  specification text NOT NULL DEFAULT '',
  maker text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT '개',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (construction_id, item_key)
);

CREATE TABLE IF NOT EXISTS public.safety_cost_ppe_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  construction_id uuid NOT NULL REFERENCES public.safety_cost_constructions(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES public.safety_cost_ppe_skus(id) ON DELETE CASCADE,
  movement_type text NOT NULL
    CHECK (movement_type IN ('in', 'out', 'adjust', 'return', 'dispose')),
  quantity numeric NOT NULL CHECK (quantity > 0),
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  source_type text NOT NULL DEFAULT 'manual',
  -- item | issuance | import | manual | adjust
  source_item_id uuid REFERENCES public.safety_cost_items(id) ON DELETE SET NULL,
  -- 지급대장 행 id (순환 FK 방지: 참조만 저장)
  source_issuance_id uuid,
  import_batch_id uuid REFERENCES public.safety_cost_import_batches(id) ON DELETE SET NULL,
  report_id uuid REFERENCES public.safety_cost_monthly_reports(id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ppe_skus_construction
  ON public.safety_cost_ppe_skus(construction_id);

CREATE INDEX IF NOT EXISTS idx_ppe_movements_sku
  ON public.safety_cost_ppe_stock_movements(sku_id, movement_date)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_ppe_movements_item
  ON public.safety_cost_ppe_stock_movements(source_item_id)
  WHERE source_item_id IS NOT NULL AND is_deleted = false;

ALTER TABLE public.safety_cost_ppe_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_cost_ppe_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ppe_skus_select" ON public.safety_cost_ppe_skus;
CREATE POLICY "ppe_skus_select" ON public.safety_cost_ppe_skus
  FOR SELECT TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));
DROP POLICY IF EXISTS "ppe_skus_insert" ON public.safety_cost_ppe_skus;
CREATE POLICY "ppe_skus_insert" ON public.safety_cost_ppe_skus
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));
DROP POLICY IF EXISTS "ppe_skus_update" ON public.safety_cost_ppe_skus;
CREATE POLICY "ppe_skus_update" ON public.safety_cost_ppe_skus
  FOR UPDATE TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true))
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

DROP POLICY IF EXISTS "ppe_movements_select" ON public.safety_cost_ppe_stock_movements;
CREATE POLICY "ppe_movements_select" ON public.safety_cost_ppe_stock_movements
  FOR SELECT TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));
DROP POLICY IF EXISTS "ppe_movements_insert" ON public.safety_cost_ppe_stock_movements;
CREATE POLICY "ppe_movements_insert" ON public.safety_cost_ppe_stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));
DROP POLICY IF EXISTS "ppe_movements_update" ON public.safety_cost_ppe_stock_movements;
CREATE POLICY "ppe_movements_update" ON public.safety_cost_ppe_stock_movements
  FOR UPDATE TO authenticated
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true))
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE TRIGGER update_safety_cost_ppe_skus_updated_at
BEFORE UPDATE ON public.safety_cost_ppe_skus
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 지급대장 행에 수량·수불 연결
ALTER TABLE public.safety_cost_ppe_ledger_entries
  ADD COLUMN IF NOT EXISTS quantity numeric NOT NULL DEFAULT 1;

ALTER TABLE public.safety_cost_ppe_ledger_entries
  ADD COLUMN IF NOT EXISTS stock_movement_id uuid
  REFERENCES public.safety_cost_ppe_stock_movements(id) ON DELETE SET NULL;

COMMENT ON TABLE public.safety_cost_import_batches IS
  'Legacy approved safety-cost pack import (extract → review → commit).';
COMMENT ON TABLE public.safety_cost_ppe_skus IS
  'PPE SKU master per construction for stock ledger.';
COMMENT ON TABLE public.safety_cost_ppe_stock_movements IS
  'PPE stock in/out/adjust movements (수불대장).';
