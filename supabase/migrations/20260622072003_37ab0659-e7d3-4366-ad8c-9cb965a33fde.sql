
-- Phase 1-2: Standardize soft-delete metadata across all tables that already have is_deleted.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'environment_tags','equipment_master','incident_reports','legal_duties',
    'master_assignees','master_departments','master_ppe','master_processes',
    'safety_cost_items','safety_education_materials','safety_inspections',
    'tbm_sessions','todo_items','work_permits','work_plans'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_by uuid', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_reason text', t);
  END LOOP;
END $$;
