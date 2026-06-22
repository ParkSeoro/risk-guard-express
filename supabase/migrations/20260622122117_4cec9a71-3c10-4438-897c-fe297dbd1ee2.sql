
-- 1) Table
CREATE TABLE public.work_plan_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_plan_id UUID NOT NULL REFERENCES public.work_plans(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('legal','calc_evidence','site_proof')),
  attachment_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  file_url TEXT,
  file_path TEXT,
  mime_type TEXT,
  file_size BIGINT,
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','auto_equipment','auto_msds','auto_env_measurement','auto_cert','auto_other')),
  source_table TEXT,
  source_ref_id UUID,
  calc_ref TEXT,
  is_mandatory BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false,
  retention_until DATE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wpa_plan ON public.work_plan_attachments(work_plan_id) WHERE is_deleted = false;
CREATE INDEX idx_wpa_project ON public.work_plan_attachments(project_id) WHERE is_deleted = false;
CREATE UNIQUE INDEX uq_wpa_key ON public.work_plan_attachments(work_plan_id, attachment_key) WHERE is_deleted = false;

-- 2) Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_plan_attachments TO authenticated;
GRANT ALL ON public.work_plan_attachments TO service_role;

-- 3) RLS
ALTER TABLE public.work_plan_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wpa_select_project_members" ON public.work_plan_attachments
  FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "wpa_insert_project_members" ON public.work_plan_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_project_member(auth.uid(), project_id)
    AND public.can_write_company_data(auth.uid(), project_id, company_id)
  );

CREATE POLICY "wpa_update_unlocked" ON public.work_plan_attachments
  FOR UPDATE TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND (locked = false OR public.is_master(auth.uid()))
  )
  WITH CHECK (
    public.is_project_member(auth.uid(), project_id)
    AND (locked = false OR public.is_master(auth.uid()))
  );

CREATE POLICY "wpa_delete_unlocked" ON public.work_plan_attachments
  FOR DELETE TO authenticated
  USING (
    public.is_project_member(auth.uid(), project_id)
    AND (locked = false OR public.is_master(auth.uid()))
  );

-- 4) updated_at trigger
CREATE TRIGGER trg_wpa_updated_at
  BEFORE UPDATE ON public.work_plan_attachments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Default retention (3 years) when missing
CREATE OR REPLACE FUNCTION public.set_default_retention()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.retention_until IS NULL THEN
    NEW.retention_until := (CURRENT_DATE + INTERVAL '3 years')::date;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_wpa_default_retention
  BEFORE INSERT ON public.work_plan_attachments
  FOR EACH ROW EXECUTE FUNCTION public.set_default_retention();

-- 6) Auto-lock on plan approval
CREATE OR REPLACE FUNCTION public.lock_wpa_on_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '승인완료' AND COALESCE(OLD.status,'') <> '승인완료' THEN
    UPDATE public.work_plan_attachments
       SET locked = true, updated_at = now()
     WHERE work_plan_id = NEW.id AND COALESCE(is_deleted,false) = false;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_lock_wpa_on_approval ON public.work_plans;
CREATE TRIGGER trg_lock_wpa_on_approval
  AFTER UPDATE OF status ON public.work_plans
  FOR EACH ROW EXECUTE FUNCTION public.lock_wpa_on_approval();

-- 7) Helper: list missing mandatory attachments
CREATE OR REPLACE FUNCTION public.get_wpa_missing_mandatory(_plan_id UUID)
RETURNS TABLE(attachment_key TEXT, name TEXT, category TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT attachment_key, name, category
  FROM public.work_plan_attachments
  WHERE work_plan_id = _plan_id
    AND COALESCE(is_deleted,false) = false
    AND is_mandatory = true
    AND (file_url IS NULL OR file_url = '');
$$;
