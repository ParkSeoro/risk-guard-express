-- Phase 2: Confirmation-based Hybrid Document Vault (strict company_id tenant isolation)
CREATE TABLE IF NOT EXISTS public.company_document_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  attachment_key text NOT NULL,
  doc_name text NOT NULL,
  file_url text NOT NULL,
  file_path text,
  file_size bigint,
  mime_type text,
  holder_name text,
  reg_or_cert_no text,
  expiry_date date,
  source_work_plan_id uuid REFERENCES public.work_plans(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_document_vault_active_key
  ON public.company_document_vault (project_id, company_id, attachment_key)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_company_document_vault_scope
  ON public.company_document_vault (project_id, company_id)
  WHERE is_deleted = false;

ALTER TABLE public.company_document_vault ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_document_vault' AND policyname = 'cdv_select_company_scoped'
  ) THEN
    CREATE POLICY cdv_select_company_scoped
      ON public.company_document_vault
      FOR SELECT
      USING (
        is_project_member(auth.uid(), project_id)
        AND can_read_company_data(auth.uid(), project_id, company_id)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_document_vault' AND policyname = 'cdv_insert_company_scoped'
  ) THEN
    CREATE POLICY cdv_insert_company_scoped
      ON public.company_document_vault
      FOR INSERT
      WITH CHECK (
        is_project_member(auth.uid(), project_id)
        AND can_write_company_data(auth.uid(), project_id, company_id)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_document_vault' AND policyname = 'cdv_update_company_scoped'
  ) THEN
    CREATE POLICY cdv_update_company_scoped
      ON public.company_document_vault
      FOR UPDATE
      USING (
        is_project_member(auth.uid(), project_id)
        AND can_write_company_data(auth.uid(), project_id, company_id)
      )
      WITH CHECK (
        is_project_member(auth.uid(), project_id)
        AND can_write_company_data(auth.uid(), project_id, company_id)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_document_vault' AND policyname = 'cdv_delete_company_scoped'
  ) THEN
    CREATE POLICY cdv_delete_company_scoped
      ON public.company_document_vault
      FOR DELETE
      USING (
        is_project_member(auth.uid(), project_id)
        AND can_write_company_data(auth.uid(), project_id, company_id)
      );
  END IF;
END $$;

ALTER TABLE public.equipment_master
  ADD COLUMN IF NOT EXISTS reg_cert_url text,
  ADD COLUMN IF NOT EXISTS inspection_cert_url text,
  ADD COLUMN IF NOT EXISTS inspection_expiry_date date,
  ADD COLUMN IF NOT EXISTS insurance_url text,
  ADD COLUMN IF NOT EXISTS insurance_expiry_date date,
  ADD COLUMN IF NOT EXISTS spec_sheet_url text;

COMMENT ON TABLE public.company_document_vault IS
  'Company-scoped reusable work-plan supporting documents with expiry tracking (Phase 2 hybrid vault; confirmation-only reuse).';
