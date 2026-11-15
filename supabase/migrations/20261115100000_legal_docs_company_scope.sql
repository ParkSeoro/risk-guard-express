-- 안전보건대장·건진법 기록은 회사 범위로만 읽는다.
-- 마스터와 발주처는 현장 전체. 시공사 관리 역할은 자사와 하위 협력사.
-- 협력사·공급사와 근로자·열람자는 자사만. 회사가 비어 있는 옛 행은 마스터·발주처만.

ALTER TABLE public.client_safety_ledgers
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_safety_ledgers_company
  ON public.client_safety_ledgers (project_id, company_id)
  WHERE is_deleted = false;

UPDATE public.ctpa_compliance_records r
   SET company_id = sub.company_id
  FROM (
    SELECT DISTINCT ON (pm.project_id, pm.user_id)
           pm.project_id,
           pm.user_id,
           pm.company_id
      FROM public.project_members pm
     WHERE pm.company_id IS NOT NULL
     ORDER BY pm.project_id, pm.user_id
  ) sub
 WHERE r.company_id IS NULL
   AND r.created_by = sub.user_id
   AND r.project_id = sub.project_id;

CREATE OR REPLACE FUNCTION public.can_read_scoped_company_doc(
  _project_id uuid,
  _company_id uuid,
  _uid uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _rec record;
  _type text;
  _role text;
  _tree uuid[];
BEGIN
  IF _uid IS NULL OR _project_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_master(_uid) THEN
    RETURN true;
  END IF;
  IF NOT public.is_project_member(_uid, _project_id) THEN
    RETURN false;
  END IF;

  FOR _rec IN
    SELECT pm.company_id,
           COALESCE(pm.role_new::text, '') AS role_name,
           c.type AS company_type
      FROM public.project_members pm
      LEFT JOIN public.companies c ON c.id = pm.company_id
     WHERE pm.user_id = _uid
       AND pm.project_id = _project_id
  LOOP
    _type := lower(trim(COALESCE(_rec.company_type, '')));
    _role := lower(trim(COALESCE(_rec.role_name, '')));

    IF _type IN ('client', '발주처', 'owner', '발주') THEN
      RETURN true;
    END IF;

    IF _company_id IS NULL THEN
      CONTINUE;
    END IF;

    IF _type IN ('gc', '시공사', '원도급', '원청', 'general_contractor')
       AND _role NOT IN ('worker', 'viewer') THEN
      _tree := public.project_company_tree(_project_id, _rec.company_id);
      IF _company_id = ANY(_tree) THEN
        RETURN true;
      END IF;
      CONTINUE;
    END IF;

    IF _rec.company_id IS NOT NULL AND _rec.company_id = _company_id THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_read_scoped_company_doc(uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS client_safety_ledgers_select ON public.client_safety_ledgers;
CREATE POLICY client_safety_ledgers_select ON public.client_safety_ledgers
  FOR SELECT TO authenticated
  USING (public.can_read_scoped_company_doc(project_id, company_id, auth.uid()));

DROP POLICY IF EXISTS client_safety_ledgers_insert ON public.client_safety_ledgers;
CREATE POLICY client_safety_ledgers_insert ON public.client_safety_ledgers
  FOR INSERT TO authenticated
  WITH CHECK (public.can_read_scoped_company_doc(project_id, company_id, auth.uid()));

DROP POLICY IF EXISTS client_safety_ledgers_update ON public.client_safety_ledgers;
CREATE POLICY client_safety_ledgers_update ON public.client_safety_ledgers
  FOR UPDATE TO authenticated
  USING (public.can_read_scoped_company_doc(project_id, company_id, auth.uid()))
  WITH CHECK (public.can_read_scoped_company_doc(project_id, company_id, auth.uid()));

DROP POLICY IF EXISTS ctpa_compliance_records_select ON public.ctpa_compliance_records;
CREATE POLICY ctpa_compliance_records_select ON public.ctpa_compliance_records
  FOR SELECT TO authenticated
  USING (public.can_read_scoped_company_doc(project_id, company_id, auth.uid()));

DROP POLICY IF EXISTS ctpa_compliance_records_insert ON public.ctpa_compliance_records;
CREATE POLICY ctpa_compliance_records_insert ON public.ctpa_compliance_records
  FOR INSERT TO authenticated
  WITH CHECK (public.can_read_scoped_company_doc(project_id, company_id, auth.uid()));

DROP POLICY IF EXISTS ctpa_compliance_records_update ON public.ctpa_compliance_records;
CREATE POLICY ctpa_compliance_records_update ON public.ctpa_compliance_records
  FOR UPDATE TO authenticated
  USING (public.can_read_scoped_company_doc(project_id, company_id, auth.uid()))
  WITH CHECK (public.can_read_scoped_company_doc(project_id, company_id, auth.uid()));
