-- Orphan tables referenced by later migrations but never CREATE'd in history.
-- Inserted before 20260318014735 (policy tighten on risk_item_versions).

CREATE TABLE IF NOT EXISTS public.risk_item_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_item_id uuid NOT NULL REFERENCES public.risk_items(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_reason text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz DEFAULT now()
);
ALTER TABLE public.risk_item_versions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='risk_item_versions' AND policyname='System can insert versions') THEN
    CREATE POLICY "System can insert versions" ON public.risk_item_versions
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='risk_item_versions' AND policyname='Members can view versions') THEN
    CREATE POLICY "Members can view versions" ON public.risk_item_versions
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.risk_items ri
        WHERE ri.id = risk_item_id AND public.is_project_member(auth.uid(), ri.project_id)
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  risk_item_id uuid REFERENCES public.risk_items(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text,
  content text NOT NULL DEFAULT '',
  mentions uuid[] DEFAULT ARRAY[]::uuid[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='comments' AND policyname='Members can view comments') THEN
    CREATE POLICY "Members can view comments" ON public.comments FOR SELECT TO authenticated
      USING (public.is_project_member(auth.uid(), project_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='comments' AND policyname='Members can insert comments') THEN
    CREATE POLICY "Members can insert comments" ON public.comments FOR INSERT TO authenticated
      WITH CHECK (public.is_project_member(auth.uid(), project_id));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.generated_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT '',
  source_id text,
  options jsonb,
  risk_distribution jsonb,
  total_items integer,
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.generated_batches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='generated_batches' AND policyname='Members can view generated_batches') THEN
    CREATE POLICY "Members can view generated_batches" ON public.generated_batches FOR SELECT TO authenticated
      USING (public.is_project_member(auth.uid(), project_id));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.schedule_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name text NOT NULL DEFAULT '',
  file_path text NOT NULL DEFAULT '',
  column_mapping jsonb,
  parsed_rows jsonb,
  status text DEFAULT 'uploaded',
  total_generated integer,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.schedule_uploads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='schedule_uploads' AND policyname='Members can view schedule_uploads') THEN
    CREATE POLICY "Members can view schedule_uploads" ON public.schedule_uploads FOR SELECT TO authenticated
      USING (public.is_project_member(auth.uid(), project_id));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text NOT NULL,
  rule_type text NOT NULL DEFAULT '',
  description text,
  severity text DEFAULT 'warning',
  weight numeric,
  check_config jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.validation_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='validation_rules' AND policyname='Anyone can read validation_rules') THEN
    CREATE POLICY "Anyone can read validation_rules" ON public.validation_rules FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
