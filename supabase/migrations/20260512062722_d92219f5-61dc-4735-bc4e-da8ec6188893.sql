
-- ========== HELPERS ==========
CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_master(_user_id) OR EXISTS (
    SELECT 1 FROM public.project_members
    WHERE user_id = _user_id AND role_new = 'project_admin'::public.project_role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_project_admin(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_project_role(_user_id, _project_id, ARRAY['project_admin']::public.project_role[])
$$;

-- Re-point is_admin to new logic (still used widely in code/policies; we keep signature)
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_global_admin(_user_id)
$$;

-- can_access_safety_cost: rewrite to use new helpers
CREATE OR REPLACE FUNCTION public.can_access_safety_cost(_user_id uuid, _project_id uuid, _company_id uuid, _write boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _role public.project_role;
BEGIN
  IF _user_id IS NULL OR _project_id IS NULL THEN RETURN false; END IF;
  IF public.is_master(_user_id) THEN RETURN true; END IF;

  SELECT role_new INTO _role FROM public.project_members
   WHERE user_id = _user_id AND project_id = _project_id LIMIT 1;
  IF _role IS NULL THEN RETURN false; END IF;
  IF _role IN ('project_admin','safety_manager') THEN RETURN true; END IF;
  IF _write AND _role = 'viewer' THEN RETURN false; END IF;
  IF _company_id IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.user_id = _user_id AND pm.project_id = _project_id AND pm.company_id = _company_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_impersonate_check(_target_user uuid, _project_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _proj_role text;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  _proj_role := COALESCE(public.get_project_role_new(_target_user, _project_id)::text, 'viewer');
  RETURN jsonb_build_object(
    'is_master', public.is_master(_target_user),
    'project_role', _proj_role,
    'is_member', public.is_project_member(_target_user, _project_id)
  );
END;
$$;

-- ========== POLICIES ==========

-- accident_cases
DROP POLICY IF EXISTS "Admins can delete accident cases" ON public.accident_cases;
DROP POLICY IF EXISTS "Admins can insert accident cases" ON public.accident_cases;
DROP POLICY IF EXISTS "Admins can update accident cases" ON public.accident_cases;
CREATE POLICY "Admins can insert accident cases" ON public.accident_cases FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update accident cases" ON public.accident_cases FOR UPDATE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can delete accident cases" ON public.accident_cases FOR DELETE USING (is_global_admin(auth.uid()));

-- ai_generated_items_buffer
DROP POLICY IF EXISTS "ai_buffer delete master" ON public.ai_generated_items_buffer;
DROP POLICY IF EXISTS "ai_buffer select via job" ON public.ai_generated_items_buffer;
CREATE POLICY "ai_buffer delete master" ON public.ai_generated_items_buffer FOR DELETE USING (is_master(auth.uid()));
CREATE POLICY "ai_buffer select via job" ON public.ai_generated_items_buffer FOR SELECT USING (
  EXISTS (SELECT 1 FROM ai_generation_jobs j WHERE j.id = job_id AND is_project_member(auth.uid(), j.project_id))
);

-- ai_generation_jobs
DROP POLICY IF EXISTS "ai_jobs delete master" ON public.ai_generation_jobs;
DROP POLICY IF EXISTS "ai_jobs insert members" ON public.ai_generation_jobs;
DROP POLICY IF EXISTS "ai_jobs select members" ON public.ai_generation_jobs;
DROP POLICY IF EXISTS "ai_jobs update master or owner" ON public.ai_generation_jobs;
CREATE POLICY "ai_jobs delete master" ON public.ai_generation_jobs FOR DELETE USING (is_master(auth.uid()));
CREATE POLICY "ai_jobs insert members" ON public.ai_generation_jobs FOR INSERT WITH CHECK (auth.uid() = created_by AND is_project_member(auth.uid(), project_id));
CREATE POLICY "ai_jobs select members" ON public.ai_generation_jobs FOR SELECT USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "ai_jobs update master or owner" ON public.ai_generation_jobs FOR UPDATE USING (is_master(auth.uid()) OR auth.uid() = created_by);

-- ai_generation_logs
DROP POLICY IF EXISTS "ai_logs select master or job owner" ON public.ai_generation_logs;
CREATE POLICY "ai_logs select master or job owner" ON public.ai_generation_logs FOR SELECT USING (
  is_master(auth.uid()) OR EXISTS (
    SELECT 1 FROM ai_generation_jobs j WHERE j.id = job_id AND (j.created_by = auth.uid() OR is_project_member(auth.uid(), j.project_id))
  )
);

-- ai_settings
DROP POLICY IF EXISTS "Masters can insert ai_settings" ON public.ai_settings;
DROP POLICY IF EXISTS "Masters can view ai_settings" ON public.ai_settings;
DROP POLICY IF EXISTS "Masters can update ai_settings" ON public.ai_settings;
CREATE POLICY "Masters can insert ai_settings" ON public.ai_settings FOR INSERT WITH CHECK (is_master(auth.uid()));
CREATE POLICY "Masters can view ai_settings" ON public.ai_settings FOR SELECT USING (is_master(auth.uid()));
CREATE POLICY "Masters can update ai_settings" ON public.ai_settings FOR UPDATE USING (is_master(auth.uid()));

-- ai_test_runs
DROP POLICY IF EXISTS "test runs master only" ON public.ai_test_runs;
CREATE POLICY "test runs master only" ON public.ai_test_runs FOR ALL USING (is_master(auth.uid())) WITH CHECK (is_master(auth.uid()));

-- approval_route_templates
DROP POLICY IF EXISTS "Admins can delete templates" ON public.approval_route_templates;
DROP POLICY IF EXISTS "Admins can insert templates" ON public.approval_route_templates;
DROP POLICY IF EXISTS "Admins can update templates" ON public.approval_route_templates;
CREATE POLICY "Admins can insert templates" ON public.approval_route_templates FOR INSERT WITH CHECK (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Admins can update templates" ON public.approval_route_templates FOR UPDATE USING (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Admins can delete templates" ON public.approval_route_templates FOR DELETE USING (is_project_admin(auth.uid(), project_id));

-- assessment_runs (delete only)
DROP POLICY IF EXISTS "Admins can delete runs" ON public.assessment_runs;
CREATE POLICY "Admins can delete runs" ON public.assessment_runs FOR DELETE USING (
  is_master(auth.uid()) OR is_project_admin(auth.uid(), project_id)
);

-- comments
DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;
CREATE POLICY "Users can delete own comments" ON public.comments FOR DELETE USING (auth.uid() = user_id OR is_global_admin(auth.uid()));

-- department_assignees
DROP POLICY IF EXISTS "Project admins can delete dept assignees" ON public.department_assignees;
DROP POLICY IF EXISTS "Project admins can insert dept assignees" ON public.department_assignees;
DROP POLICY IF EXISTS "Project admins can update dept assignees" ON public.department_assignees;
CREATE POLICY "Project admins can insert dept assignees" ON public.department_assignees FOR INSERT WITH CHECK (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Project admins can update dept assignees" ON public.department_assignees FOR UPDATE USING (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Project admins can delete dept assignees" ON public.department_assignees FOR DELETE USING (is_project_admin(auth.uid(), project_id));

-- environment_tags
DROP POLICY IF EXISTS "Admins can manage env tags" ON public.environment_tags;
CREATE POLICY "Admins can manage env tags" ON public.environment_tags FOR ALL USING (is_global_admin(auth.uid())) WITH CHECK (is_global_admin(auth.uid()));

-- incident_reports
DROP POLICY IF EXISTS "Admins can delete incident reports" ON public.incident_reports;
DROP POLICY IF EXISTS "Admins can update incident reports" ON public.incident_reports;
CREATE POLICY "Admins can delete incident reports" ON public.incident_reports FOR DELETE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update incident reports" ON public.incident_reports FOR UPDATE USING (
  is_master(auth.uid())
  OR has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
  OR reporter_id = auth.uid()
);

-- inspection_responses
DROP POLICY IF EXISTS "Admins can delete inspection_responses" ON public.inspection_responses;
CREATE POLICY "Admins can delete inspection_responses" ON public.inspection_responses FOR DELETE USING (is_global_admin(auth.uid()));

-- legal_references
DROP POLICY IF EXISTS "Admins can delete legal refs" ON public.legal_references;
DROP POLICY IF EXISTS "Admins can insert legal refs" ON public.legal_references;
DROP POLICY IF EXISTS "Admins can update legal refs" ON public.legal_references;
CREATE POLICY "Admins can insert legal refs" ON public.legal_references FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update legal refs" ON public.legal_references FOR UPDATE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can delete legal refs" ON public.legal_references FOR DELETE USING (is_global_admin(auth.uid()));

-- manual_inquiries
DROP POLICY IF EXISTS "Masters can delete inquiries" ON public.manual_inquiries;
DROP POLICY IF EXISTS "Masters can view inquiries" ON public.manual_inquiries;
DROP POLICY IF EXISTS "Masters can update inquiries" ON public.manual_inquiries;
CREATE POLICY "Masters can view inquiries" ON public.manual_inquiries FOR SELECT USING (is_master(auth.uid()));
CREATE POLICY "Masters can update inquiries" ON public.manual_inquiries FOR UPDATE USING (is_master(auth.uid()));
CREATE POLICY "Masters can delete inquiries" ON public.manual_inquiries FOR DELETE USING (is_master(auth.uid()));

-- master_assignees
DROP POLICY IF EXISTS "Admins can delete assignees" ON public.master_assignees;
DROP POLICY IF EXISTS "Admins can insert assignees" ON public.master_assignees;
DROP POLICY IF EXISTS "Admins can view assignees" ON public.master_assignees;
DROP POLICY IF EXISTS "Admins can update assignees" ON public.master_assignees;
CREATE POLICY "Admins can view assignees" ON public.master_assignees FOR SELECT USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can insert assignees" ON public.master_assignees FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update assignees" ON public.master_assignees FOR UPDATE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can delete assignees" ON public.master_assignees FOR DELETE USING (is_global_admin(auth.uid()));

-- master_departments
DROP POLICY IF EXISTS "Admins can delete departments" ON public.master_departments;
DROP POLICY IF EXISTS "Admins can insert departments" ON public.master_departments;
DROP POLICY IF EXISTS "Admins can update departments" ON public.master_departments;
CREATE POLICY "Admins can insert departments" ON public.master_departments FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update departments" ON public.master_departments FOR UPDATE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can delete departments" ON public.master_departments FOR DELETE USING (is_global_admin(auth.uid()));

-- master_ppe
DROP POLICY IF EXISTS "Admins can delete PPE" ON public.master_ppe;
DROP POLICY IF EXISTS "Admins can insert PPE" ON public.master_ppe;
DROP POLICY IF EXISTS "Admins can update PPE" ON public.master_ppe;
CREATE POLICY "Admins can insert PPE" ON public.master_ppe FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update PPE" ON public.master_ppe FOR UPDATE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can delete PPE" ON public.master_ppe FOR DELETE USING (is_global_admin(auth.uid()));

-- master_processes
DROP POLICY IF EXISTS "Admins can delete processes" ON public.master_processes;
DROP POLICY IF EXISTS "Admins can insert processes" ON public.master_processes;
DROP POLICY IF EXISTS "Admins can update processes" ON public.master_processes;
CREATE POLICY "Admins can insert processes" ON public.master_processes FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update processes" ON public.master_processes FOR UPDATE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can delete processes" ON public.master_processes FOR DELETE USING (is_global_admin(auth.uid()));

-- notifications
DROP POLICY IF EXISTS "Users can insert own notifications or admins" ON public.notifications;
CREATE POLICY "Users can insert own notifications or admins" ON public.notifications FOR INSERT WITH CHECK (auth.uid() = user_id OR is_global_admin(auth.uid()));

-- profiles
DROP POLICY IF EXISTS "Users can view permitted profiles" ON public.profiles;
DROP POLICY IF EXISTS "Masters can update any profile" ON public.profiles;
CREATE POLICY "Users can view permitted profiles" ON public.profiles FOR SELECT USING (
  auth.uid() = user_id OR is_master(auth.uid()) OR shares_project_with(auth.uid(), user_id)
);
CREATE POLICY "Masters can update any profile" ON public.profiles FOR UPDATE USING (is_master(auth.uid())) WITH CHECK (is_master(auth.uid()));

-- project_invites (note: original had swapped args bug; fixed here)
DROP POLICY IF EXISTS "Project admins can delete invites" ON public.project_invites;
DROP POLICY IF EXISTS "Project admins can create invites" ON public.project_invites;
DROP POLICY IF EXISTS "Project admins can update invites" ON public.project_invites;
CREATE POLICY "Project admins can create invites" ON public.project_invites FOR INSERT WITH CHECK (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Project admins can update invites" ON public.project_invites FOR UPDATE USING (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Project admins can delete invites" ON public.project_invites FOR DELETE USING (is_project_admin(auth.uid(), project_id));

-- project_join_requests (same swapped-arg bug fixed)
DROP POLICY IF EXISTS "Project admins can delete join requests" ON public.project_join_requests;
DROP POLICY IF EXISTS "Project admins can view join requests" ON public.project_join_requests;
DROP POLICY IF EXISTS "Project admins can update join requests" ON public.project_join_requests;
CREATE POLICY "Project admins can view join requests" ON public.project_join_requests FOR SELECT USING (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Project admins can update join requests" ON public.project_join_requests FOR UPDATE USING (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Project admins can delete join requests" ON public.project_join_requests FOR DELETE USING (is_project_admin(auth.uid(), project_id));

-- project_members
DROP POLICY IF EXISTS "Project admins can delete members" ON public.project_members;
DROP POLICY IF EXISTS "Project admins can insert members" ON public.project_members;
DROP POLICY IF EXISTS "Project admins can update members" ON public.project_members;
CREATE POLICY "Project admins can insert members" ON public.project_members FOR INSERT WITH CHECK (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Project admins can update members" ON public.project_members FOR UPDATE USING (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Project admins can delete members" ON public.project_members FOR DELETE USING (is_project_admin(auth.uid(), project_id));

-- projects
DROP POLICY IF EXISTS "Masters can delete projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can create projects" ON public.projects;
DROP POLICY IF EXISTS "Members can view own projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can update projects" ON public.projects;
CREATE POLICY "Members can view own projects" ON public.projects FOR SELECT USING (is_project_member(auth.uid(), id) OR is_master(auth.uid()));
CREATE POLICY "Admins can create projects" ON public.projects FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update projects" ON public.projects FOR UPDATE USING (is_master(auth.uid()) OR is_project_admin(auth.uid(), id));
CREATE POLICY "Masters can delete projects" ON public.projects FOR DELETE USING (is_master(auth.uid()));

-- push_subscriptions
DROP POLICY IF EXISTS "master read all subs" ON public.push_subscriptions;
CREATE POLICY "master read all subs" ON public.push_subscriptions FOR SELECT USING (is_master(auth.uid()));

-- risk_knowledge_base
DROP POLICY IF EXISTS "kb delete master" ON public.risk_knowledge_base;
DROP POLICY IF EXISTS "kb insert master" ON public.risk_knowledge_base;
DROP POLICY IF EXISTS "kb update master" ON public.risk_knowledge_base;
CREATE POLICY "kb insert master" ON public.risk_knowledge_base FOR INSERT WITH CHECK (is_master(auth.uid()));
CREATE POLICY "kb update master" ON public.risk_knowledge_base FOR UPDATE USING (is_master(auth.uid()));
CREATE POLICY "kb delete master" ON public.risk_knowledge_base FOR DELETE USING (is_master(auth.uid()));

-- risk_templates
DROP POLICY IF EXISTS "Admins can delete templates" ON public.risk_templates;
DROP POLICY IF EXISTS "Admins can insert templates" ON public.risk_templates;
DROP POLICY IF EXISTS "Admins can update templates" ON public.risk_templates;
CREATE POLICY "Admins can insert templates" ON public.risk_templates FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update templates" ON public.risk_templates FOR UPDATE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can delete templates" ON public.risk_templates FOR DELETE USING (is_global_admin(auth.uid()));

-- risk_user_corrections
DROP POLICY IF EXISTS "corrections delete master" ON public.risk_user_corrections;
DROP POLICY IF EXISTS "corrections insert members" ON public.risk_user_corrections;
DROP POLICY IF EXISTS "corrections select members" ON public.risk_user_corrections;
CREATE POLICY "corrections insert members" ON public.risk_user_corrections FOR INSERT WITH CHECK (auth.uid() = corrected_by AND is_project_member(auth.uid(), project_id));
CREATE POLICY "corrections select members" ON public.risk_user_corrections FOR SELECT USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "corrections delete master" ON public.risk_user_corrections FOR DELETE USING (is_master(auth.uid()));

-- safety_cost_approval_steps
DROP POLICY IF EXISTS "Safety cost approval steps delete admin access" ON public.safety_cost_approval_steps;
DROP POLICY IF EXISTS "Safety cost approval steps update approver access" ON public.safety_cost_approval_steps;
CREATE POLICY "Safety cost approval steps delete admin access" ON public.safety_cost_approval_steps FOR DELETE USING (is_project_admin(auth.uid(), project_id));
CREATE POLICY "Safety cost approval steps update approver access" ON public.safety_cost_approval_steps FOR UPDATE USING (
  approver_id = auth.uid() OR is_master(auth.uid()) OR has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
) WITH CHECK (
  approver_id = auth.uid() OR is_master(auth.uid()) OR has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::project_role[])
);

-- safety_cost_constructions
DROP POLICY IF EXISTS "Safety cost constructions delete admin access" ON public.safety_cost_constructions;
CREATE POLICY "Safety cost constructions delete admin access" ON public.safety_cost_constructions FOR DELETE USING (is_project_admin(auth.uid(), project_id));

-- safety_inspection_actions
DROP POLICY IF EXISTS "Admins can delete insp actions" ON public.safety_inspection_actions;
CREATE POLICY "Admins can delete insp actions" ON public.safety_inspection_actions FOR DELETE USING (is_global_admin(auth.uid()));

-- scoring_config
DROP POLICY IF EXISTS "Admins can insert config" ON public.scoring_config;
DROP POLICY IF EXISTS "Admins can update config" ON public.scoring_config;
CREATE POLICY "Admins can insert config" ON public.scoring_config FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update config" ON public.scoring_config FOR UPDATE USING (is_global_admin(auth.uid()));

-- standard_risk_library
DROP POLICY IF EXISTS "Admins can delete library" ON public.standard_risk_library;
DROP POLICY IF EXISTS "Admins can insert library" ON public.standard_risk_library;
DROP POLICY IF EXISTS "Admins can update library" ON public.standard_risk_library;
CREATE POLICY "Admins can insert library" ON public.standard_risk_library FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update library" ON public.standard_risk_library FOR UPDATE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can delete library" ON public.standard_risk_library FOR DELETE USING (is_global_admin(auth.uid()));

-- system_test_artifacts/results/runs
DROP POLICY IF EXISTS "master all sta" ON public.system_test_artifacts;
DROP POLICY IF EXISTS "master all srr" ON public.system_test_results;
DROP POLICY IF EXISTS "master all str" ON public.system_test_runs;
CREATE POLICY "master all sta" ON public.system_test_artifacts FOR ALL USING (is_master(auth.uid())) WITH CHECK (is_master(auth.uid()));
CREATE POLICY "master all srr" ON public.system_test_results FOR ALL USING (is_master(auth.uid())) WITH CHECK (is_master(auth.uid()));
CREATE POLICY "master all str" ON public.system_test_runs FOR ALL USING (is_master(auth.uid())) WITH CHECK (is_master(auth.uid()));

-- tbm_participations
DROP POLICY IF EXISTS "Admins can view tbm_participations" ON public.tbm_participations;
CREATE POLICY "Admins can view tbm_participations" ON public.tbm_participations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM tbm_sessions s
    WHERE s.id = tbm_session_id
      AND is_project_member(auth.uid(), s.project_id)
      AND (is_master(auth.uid()) OR has_project_role(auth.uid(), s.project_id, ARRAY['project_admin','safety_manager']::project_role[]))
  )
);

-- todo_items
DROP POLICY IF EXISTS "Users can delete own todos" ON public.todo_items;
DROP POLICY IF EXISTS "Users can view own todos" ON public.todo_items;
DROP POLICY IF EXISTS "Users can update own todos" ON public.todo_items;
CREATE POLICY "Users can view own todos" ON public.todo_items FOR SELECT USING (user_id = auth.uid() OR is_global_admin(auth.uid()));
CREATE POLICY "Users can update own todos" ON public.todo_items FOR UPDATE USING (user_id = auth.uid() OR is_global_admin(auth.uid()));
CREATE POLICY "Users can delete own todos" ON public.todo_items FOR DELETE USING (user_id = auth.uid() OR is_global_admin(auth.uid()));

-- user_roles
DROP POLICY IF EXISTS "Masters can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Masters can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Masters can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles or masters all" ON public.user_roles;
CREATE POLICY "Users can view own roles or masters all" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR is_master(auth.uid()));
CREATE POLICY "Masters can manage roles" ON public.user_roles FOR INSERT WITH CHECK (is_master(auth.uid()));
CREATE POLICY "Masters can update roles" ON public.user_roles FOR UPDATE USING (is_master(auth.uid()));
CREATE POLICY "Masters can delete roles" ON public.user_roles FOR DELETE USING (is_master(auth.uid()));

-- validation_rules
DROP POLICY IF EXISTS "Admins can delete rules" ON public.validation_rules;
DROP POLICY IF EXISTS "Admins can insert rules" ON public.validation_rules;
DROP POLICY IF EXISTS "Admins can update rules" ON public.validation_rules;
CREATE POLICY "Admins can insert rules" ON public.validation_rules FOR INSERT WITH CHECK (is_global_admin(auth.uid()));
CREATE POLICY "Admins can update rules" ON public.validation_rules FOR UPDATE USING (is_global_admin(auth.uid()));
CREATE POLICY "Admins can delete rules" ON public.validation_rules FOR DELETE USING (is_global_admin(auth.uid()));

-- work_permits
DROP POLICY IF EXISTS "Admins can delete work_permits" ON public.work_permits;
CREATE POLICY "Admins can delete work_permits" ON public.work_permits FOR DELETE USING (is_global_admin(auth.uid()));
