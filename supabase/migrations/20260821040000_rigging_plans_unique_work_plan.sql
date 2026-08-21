-- One work plan → one rigging plan (dedupe then unique).
DELETE FROM public.rigging_plans a
 USING public.rigging_plans b
 WHERE a.work_plan_id = b.work_plan_id
   AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rigging_plans_work_plan_id
  ON public.rigging_plans (work_plan_id);
