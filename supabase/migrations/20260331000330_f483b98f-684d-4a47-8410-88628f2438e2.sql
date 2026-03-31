
-- 1. 회사 공사정보 확장 테이블
CREATE TABLE public.company_construction_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  construction_name text NOT NULL DEFAULT '',
  construction_period_start date,
  construction_period_end date,
  construction_amount bigint DEFAULT 0,
  construction_type text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, project_id)
);

ALTER TABLE public.company_construction_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view construction info" ON public.company_construction_info
  FOR SELECT TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert construction info" ON public.company_construction_info
  FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update construction info" ON public.company_construction_info
  FOR UPDATE TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete construction info" ON public.company_construction_info
  FOR DELETE TO authenticated USING (is_admin(auth.uid()));

-- 2. 작업계획서 테이블
CREATE TABLE public.work_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  work_type text NOT NULL,
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '작성중',
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view work plans" ON public.work_plans
  FOR SELECT TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert work plans" ON public.work_plans
  FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update work plans" ON public.work_plans
  FOR UPDATE TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete work plans" ON public.work_plans
  FOR DELETE TO authenticated USING (is_project_member(auth.uid(), project_id));

-- 3. 리깅플랜 테이블
CREATE TABLE public.rigging_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_plan_id uuid NOT NULL REFERENCES public.work_plans(id) ON DELETE CASCADE,
  load_weight numeric NOT NULL DEFAULT 0,
  load_description text DEFAULT '',
  crane_model text DEFAULT '',
  crane_capacity numeric DEFAULT 0,
  working_radius numeric DEFAULT 0,
  boom_length numeric DEFAULT 0,
  lifting_method text DEFAULT '',
  sling_type text DEFAULT '',
  sling_capacity numeric DEFAULT 0,
  ground_bearing_capacity numeric DEFAULT 0,
  outrigger_setup text DEFAULT '',
  safety_factor numeric DEFAULT 0,
  calculated_utilization numeric DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rigging_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view rigging plans" ON public.rigging_plans
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.work_plans wp WHERE wp.id = rigging_plans.work_plan_id AND is_project_member(auth.uid(), wp.project_id))
  );
CREATE POLICY "Members can insert rigging plans" ON public.rigging_plans
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.work_plans wp WHERE wp.id = rigging_plans.work_plan_id AND is_project_member(auth.uid(), wp.project_id))
  );
CREATE POLICY "Members can update rigging plans" ON public.rigging_plans
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.work_plans wp WHERE wp.id = rigging_plans.work_plan_id AND is_project_member(auth.uid(), wp.project_id))
  );
CREATE POLICY "Members can delete rigging plans" ON public.rigging_plans
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.work_plans wp WHERE wp.id = rigging_plans.work_plan_id AND is_project_member(auth.uid(), wp.project_id))
  );

-- 4. 법적업무 테이블
CREATE TABLE public.legal_duties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  duty_name text NOT NULL,
  duty_category text NOT NULL DEFAULT 'daily',
  legal_basis text DEFAULT '',
  frequency text NOT NULL DEFAULT 'daily',
  description text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.legal_duties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view legal duties" ON public.legal_duties
  FOR SELECT TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert legal duties" ON public.legal_duties
  FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update legal duties" ON public.legal_duties
  FOR UPDATE TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete legal duties" ON public.legal_duties
  FOR DELETE TO authenticated USING (is_project_member(auth.uid(), project_id));

-- 5. To-Do 테이블
CREATE TABLE public.todo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  legal_duty_id uuid REFERENCES public.legal_duties(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text DEFAULT '',
  due_date date NOT NULL,
  frequency text NOT NULL DEFAULT 'daily',
  status text NOT NULL DEFAULT '미완료',
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.todo_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own todos" ON public.todo_items
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_admin(auth.uid()));
CREATE POLICY "Users can insert todos" ON public.todo_items
  FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Users can update own todos" ON public.todo_items
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR is_admin(auth.uid()));
CREATE POLICY "Users can delete own todos" ON public.todo_items
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR is_admin(auth.uid()));
