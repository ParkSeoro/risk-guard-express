
-- 1. company_departments
CREATE TABLE public.company_departments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_departments TO authenticated;
GRANT ALL ON public.company_departments TO service_role;
ALTER TABLE public.company_departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view company departments"
  ON public.company_departments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.companies c
    WHERE c.id = company_departments.company_id
      AND public.is_project_member(auth.uid(), c.project_id)
      AND public.can_access_company_data(auth.uid(), c.project_id, c.id)));

CREATE POLICY "write company departments"
  ON public.company_departments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.companies c
    WHERE c.id = company_departments.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)));

CREATE POLICY "update company departments"
  ON public.company_departments FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.companies c
    WHERE c.id = company_departments.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)));

CREATE POLICY "delete company departments"
  ON public.company_departments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.companies c
    WHERE c.id = company_departments.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)));

CREATE TRIGGER trg_company_departments_updated_at
  BEFORE UPDATE ON public.company_departments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. company_managers
CREATE TABLE public.company_managers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.company_departments(id) ON DELETE SET NULL,
  name text NOT NULL,
  position text NOT NULL DEFAULT 'manager',
  phone text DEFAULT '',
  email text DEFAULT '',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_primary boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_managers_company ON public.company_managers(company_id) WHERE is_deleted = false;
CREATE INDEX idx_company_managers_user ON public.company_managers(user_id) WHERE user_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_managers TO authenticated;
GRANT ALL ON public.company_managers TO service_role;
ALTER TABLE public.company_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view company managers"
  ON public.company_managers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.companies c
    WHERE c.id = company_managers.company_id
      AND public.is_project_member(auth.uid(), c.project_id)
      AND public.can_access_company_data(auth.uid(), c.project_id, c.id)));

CREATE POLICY "insert company managers"
  ON public.company_managers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.companies c
    WHERE c.id = company_managers.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)));

CREATE POLICY "update company managers"
  ON public.company_managers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.companies c
    WHERE c.id = company_managers.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)));

CREATE POLICY "delete company managers"
  ON public.company_managers FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.companies c
    WHERE c.id = company_managers.company_id
      AND public.can_write_company_data(auth.uid(), c.project_id, c.id)));

CREATE TRIGGER trg_company_managers_updated_at
  BEFORE UPDATE ON public.company_managers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Trigger: when company_manager linked to user_id, auto upsert project_members
CREATE OR REPLACE FUNCTION public.sync_company_manager_to_project_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_role public.project_role;
  v_position public.project_position;
BEGIN
  IF NEW.user_id IS NULL OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  SELECT project_id INTO v_project_id FROM public.companies WHERE id = NEW.company_id;
  IF v_project_id IS NULL THEN RETURN NEW; END IF;

  -- Map position string → project_role
  v_role := CASE lower(NEW.position)
    WHEN 'safety_manager' THEN 'safety_manager'::public.project_role
    WHEN 'site_manager' THEN 'site_manager'::public.project_role
    WHEN 'project_admin' THEN 'project_admin'::public.project_role
    ELSE 'user'::public.project_role
  END;

  -- Best-effort position mapping
  BEGIN
    v_position := NEW.position::public.project_position;
  EXCEPTION WHEN others THEN
    v_position := NULL;
  END;

  INSERT INTO public.project_members (project_id, user_id, company_id, role_new, position_new)
  VALUES (v_project_id, NEW.user_id, NEW.company_id, v_role, v_position)
  ON CONFLICT (project_id, user_id) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    role_new = CASE
      WHEN public.project_members.role_new IN ('project_admin', 'safety_manager') THEN public.project_members.role_new
      ELSE EXCLUDED.role_new
    END,
    position_new = COALESCE(EXCLUDED.position_new, public.project_members.position_new);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_company_manager_sync_member
  AFTER INSERT OR UPDATE OF user_id, position, is_deleted ON public.company_managers
  FOR EACH ROW EXECUTE FUNCTION public.sync_company_manager_to_project_member();

-- 4. Unified assignee pool view (company managers + project members)
CREATE OR REPLACE VIEW public.project_assignee_pool
WITH (security_invoker = on) AS
SELECT
  c.project_id,
  c.id AS company_id,
  c.name AS company_name,
  cm.id AS source_id,
  'company_manager'::text AS source,
  cm.user_id,
  cm.name AS display_name,
  cm.position,
  cm.phone,
  cm.email,
  cm.department_id,
  cd.name AS department_name
FROM public.company_managers cm
JOIN public.companies c ON c.id = cm.company_id
LEFT JOIN public.company_departments cd ON cd.id = cm.department_id
WHERE cm.is_deleted = false AND c.is_deleted = false
UNION ALL
SELECT
  pm.project_id,
  pm.company_id,
  c.name AS company_name,
  pm.id AS source_id,
  'project_member'::text AS source,
  pm.user_id,
  COALESCE(p.display_name, pm.user_id::text) AS display_name,
  COALESCE(pm.position_new::text, p.position, pm.role_new::text) AS position,
  '' AS phone,
  '' AS email,
  NULL::uuid AS department_id,
  NULL::text AS department_name
FROM public.project_members pm
LEFT JOIN public.companies c ON c.id = pm.company_id
LEFT JOIN public.profiles p ON p.user_id = pm.user_id;

GRANT SELECT ON public.project_assignee_pool TO authenticated;
