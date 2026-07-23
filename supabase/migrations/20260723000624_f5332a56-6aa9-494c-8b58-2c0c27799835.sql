
CREATE TABLE IF NOT EXISTS public.project_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role_in_project text NOT NULL DEFAULT 'contractor',
  is_deleted boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, company_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_companies TO authenticated;
GRANT ALL ON public.project_companies TO service_role;

ALTER TABLE public.project_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view project_companies" ON public.project_companies FOR SELECT
  USING (is_master(auth.uid()) OR is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins insert project_companies" ON public.project_companies FOR INSERT
  WITH CHECK (is_master(auth.uid()) OR is_project_admin(auth.uid(), project_id));
CREATE POLICY "Admins update project_companies" ON public.project_companies FOR UPDATE
  USING (is_master(auth.uid()) OR is_project_admin(auth.uid(), project_id));
CREATE POLICY "Admins delete project_companies" ON public.project_companies FOR DELETE
  USING (is_master(auth.uid()) OR is_project_admin(auth.uid(), project_id));

CREATE TRIGGER project_companies_updated_at BEFORE UPDATE ON public.project_companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 백필
INSERT INTO public.project_companies (project_id, company_id, role_in_project, is_deleted)
SELECT project_id, id, COALESCE(type, 'contractor'), is_deleted
FROM public.companies WHERE project_id IS NOT NULL
ON CONFLICT (project_id, company_id) DO NOTHING;

-- 중복 회사 병합 (중복 하위 레코드는 삭제)
DO $$
DECLARE dup RECORD; keeper uuid; loser uuid;
BEGIN
  FOR dup IN
    SELECT lower(trim(name)) AS n, array_agg(id ORDER BY is_deleted, created_at) AS ids
    FROM public.companies GROUP BY lower(trim(name)) HAVING COUNT(*) > 1
  LOOP
    keeper := dup.ids[1];
    FOREACH loser IN ARRAY dup.ids[2:] LOOP
      -- managers: 삭제 (중복 방지)
      DELETE FROM public.company_managers m
        WHERE m.company_id = loser
          AND EXISTS (SELECT 1 FROM public.company_managers m2
                      WHERE m2.company_id = keeper AND m2.name = m.name AND coalesce(m2.phone,'') = coalesce(m.phone,''));
      UPDATE public.company_managers SET company_id = keeper WHERE company_id = loser;

      -- departments: 중복 이름은 삭제
      DELETE FROM public.company_departments d
        WHERE d.company_id = loser
          AND EXISTS (SELECT 1 FROM public.company_departments d2
                      WHERE d2.company_id = keeper AND d2.name = d.name);
      UPDATE public.company_departments SET company_id = keeper WHERE company_id = loser;

      -- workers
      UPDATE public.workers SET company_id = keeper WHERE company_id = loser;
      UPDATE public.project_members SET company_id = keeper WHERE company_id = loser;

      UPDATE public.project_companies pc SET company_id = keeper
        WHERE company_id = loser
          AND NOT EXISTS (SELECT 1 FROM public.project_companies p2
                          WHERE p2.project_id = pc.project_id AND p2.company_id = keeper);
      DELETE FROM public.project_companies WHERE company_id = loser;

      UPDATE public.company_construction_info ci SET company_id = keeper
        WHERE company_id = loser
          AND NOT EXISTS (SELECT 1 FROM public.company_construction_info c2
                          WHERE c2.project_id = ci.project_id AND c2.company_id = keeper);
      DELETE FROM public.company_construction_info WHERE company_id = loser;

      UPDATE public.companies SET is_deleted = true, deleted_at = now(),
             deleted_reason = 'merged_into:' || keeper::text WHERE id = loser;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE public.companies ALTER COLUMN project_id DROP NOT NULL;

DROP POLICY IF EXISTS "Owners can delete companies" ON public.companies;
DROP POLICY IF EXISTS "Owners can insert companies" ON public.companies;
DROP POLICY IF EXISTS "Owners can update companies" ON public.companies;
DROP POLICY IF EXISTS "Project members can view companies" ON public.companies;

CREATE POLICY "Members and masters view companies" ON public.companies FOR SELECT
  USING (
    is_master(auth.uid())
    OR (project_id IS NOT NULL AND is_project_member(auth.uid(), project_id))
    OR EXISTS (SELECT 1 FROM public.project_companies pc
               WHERE pc.company_id = companies.id AND pc.is_deleted = false
                 AND is_project_member(auth.uid(), pc.project_id))
  );

CREATE POLICY "Master and PA insert companies" ON public.companies FOR INSERT
  WITH CHECK (
    is_master(auth.uid())
    OR (project_id IS NOT NULL AND has_project_role(auth.uid(), project_id, ARRAY['project_admin'::project_role, 'safety_manager'::project_role]))
  );

CREATE POLICY "Master and PA update companies" ON public.companies FOR UPDATE
  USING (
    is_master(auth.uid())
    OR (project_id IS NOT NULL AND has_project_role(auth.uid(), project_id, ARRAY['project_admin'::project_role, 'safety_manager'::project_role]))
    OR EXISTS (SELECT 1 FROM public.project_companies pc
               WHERE pc.company_id = companies.id
                 AND has_project_role(auth.uid(), pc.project_id, ARRAY['project_admin'::project_role, 'safety_manager'::project_role]))
  );

CREATE POLICY "Master delete companies" ON public.companies FOR DELETE
  USING (is_master(auth.uid()));

CREATE OR REPLACE VIEW public.signup_company_directory AS
SELECT p.id AS project_id, p.name AS project_name,
       c.id AS company_id, c.name AS company_name,
       pc.role_in_project AS company_type
FROM public.project_companies pc
JOIN public.projects p ON p.id = pc.project_id
JOIN public.companies c ON c.id = pc.company_id
WHERE pc.is_deleted = false AND c.is_deleted = false;

GRANT SELECT ON public.signup_company_directory TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_signup_company_selection(
  _user_id uuid, _project_id uuid, _company_id uuid, _position text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.project_companies
                 WHERE project_id = _project_id AND company_id = _company_id AND is_deleted = false) THEN
    RAISE EXCEPTION '유효하지 않은 프로젝트/업체 조합입니다';
  END IF;
  UPDATE public.profiles SET account_status = 'pending' WHERE user_id = _user_id;
  INSERT INTO public.project_members (project_id, user_id, company_id, position_new, role_new)
  VALUES (_project_id, _user_id, _company_id, _position::project_position, 'user'::project_role)
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET company_id = EXCLUDED.company_id, position_new = EXCLUDED.position_new;
END $$;

GRANT EXECUTE ON FUNCTION public.process_signup_company_selection(uuid, uuid, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.merge_companies(_src uuid, _dst uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_master(auth.uid()) THEN RAISE EXCEPTION '마스터 권한이 필요합니다'; END IF;
  IF _src = _dst THEN RAISE EXCEPTION '동일한 회사입니다'; END IF;

  DELETE FROM public.company_managers m WHERE m.company_id = _src
    AND EXISTS (SELECT 1 FROM public.company_managers m2
                WHERE m2.company_id = _dst AND m2.name = m.name AND coalesce(m2.phone,'') = coalesce(m.phone,''));
  UPDATE public.company_managers SET company_id = _dst WHERE company_id = _src;

  DELETE FROM public.company_departments d WHERE d.company_id = _src
    AND EXISTS (SELECT 1 FROM public.company_departments d2
                WHERE d2.company_id = _dst AND d2.name = d.name);
  UPDATE public.company_departments SET company_id = _dst WHERE company_id = _src;

  UPDATE public.workers SET company_id = _dst WHERE company_id = _src;
  UPDATE public.project_members SET company_id = _dst WHERE company_id = _src;

  UPDATE public.project_companies pc SET company_id = _dst WHERE company_id = _src
    AND NOT EXISTS (SELECT 1 FROM public.project_companies p2
                    WHERE p2.project_id = pc.project_id AND p2.company_id = _dst);
  DELETE FROM public.project_companies WHERE company_id = _src;

  UPDATE public.company_construction_info ci SET company_id = _dst WHERE company_id = _src
    AND NOT EXISTS (SELECT 1 FROM public.company_construction_info c2
                    WHERE c2.project_id = ci.project_id AND c2.company_id = _dst);
  DELETE FROM public.company_construction_info WHERE company_id = _src;

  UPDATE public.companies
    SET is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
        deleted_reason = 'merged_into:' || _dst::text
    WHERE id = _src;
END $$;

GRANT EXECUTE ON FUNCTION public.merge_companies(uuid, uuid) TO authenticated;
