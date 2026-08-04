// ================================================================
// Feature Coverage Manifest
// ----------------------------------------------------------------
// 새 기능을 추가하거나 기존 기능을 수정할 때 반드시 이 매니페스트에
// "어느 시나리오 키가 이 기능을 검증하는지"를 등록해야 합니다.
// 등록되지 않은 기능 영역은 coverage 시나리오에서 FAIL 로 표시됩니다.
//
// 형식: { feature_area: [scenario_key.step_key, ...] }
// scenario_key.step_key 는 SCENARIOS[scenario_key] 의 run() 이
// 반환하는 StepResult 의 (scenario_key, step_key) 와 일치해야 합니다.
// ================================================================

export const FEATURE_COVERAGE: Record<string, string[]> = {
  // 핵심 도메인 흐름
  "프로젝트 선택": ["admin.select_project"],
  "위험성평가 생성/수정": [
    "admin.create_assessment_run",
    "admin.update_assessment_run_status",
    "flow.create_ra",
    "flow.ra_risk_item_create",
  ],
  "작업계획서": ["admin.create_work_plan", "flow.ra_to_wp_link"],
  "작업허가": ["admin.create_work_permit", "flow.wp_to_permit_link"],
  "TBM 세션/QR": [
    "contractor.create_tbm",
    "contractor.tbm_qr_lookup",
    "contractor.tbm_qr_lookup_invalid",
  ],
  "근로자 등록 + QR": [
    "worker.register_worker",
    "worker.register_invalid_phone_rejected",
    "worker.register_empty_name_rejected",
    "worker.qr_token_lookup",
  ],
  "근로자 입퇴장": ["e2e.worker_entry", "e2e.worker_exit"],
  "권한/RLS": [
    "perm.master_self_check",
    "perm.rls_select_projects",
    "perm.user_roles_protected",
    "perm.rls_cross_project_blocked",
  ],
  "알림": ["notify.create_notification_row", "notify.mark_notification_read"],
  "데이터 무결성": [
    "integ.insert_then_read",
    "integ.update_reflects",
    "integ.soft_delete_hides_row",
    "integ.version_trigger_bumps",
    "integ.fk_project_enforced",
  ],
  "감사 로그": ["audit.log_writable", "audit.log_readable_and_filtered"],
  "엣지 함수": ["edgefn.fetch_weather", "edgefn.safety_assistant"],
  "E2E 페르소나 체인 (관리자→시공사→근로자)": [
    "e2e.admin_create_run",
    "e2e.admin_create_wp",
    "e2e.admin_approve_permit",
    "e2e.contractor_create_tbm",
    "e2e.worker_register",
    "e2e.worker_entry",
    "e2e.worker_exit",
    "e2e.chain_integrity",
  ],
  "모바일 환경 (HTTPS/SW/카메라/프로젝트)": [
    "mobile.secure_context",
    "mobile.service_worker",
    "mobile.selected_project_id",
    "mobile.storage_attachments_bucket",
  ],
  "모바일 셸 라우트 (/app/worker)": [
    "mobile.route__app_worker_today",
    "mobile.route__app_worker_approvals",
    "mobile.route__app_worker_geofence_drop",
    "mobile.route__app_worker_map_calibration",
  ],
  "교차 테이블 무결성 (SSOT)": [
    "xtbl.check_data_integrity_rpc",
    "xtbl.attendance_ssot_view_queryable",
  ],
  "스키마 테이블 존재": ["schema.table_projects", "schema.table_workers"],
  "핵심 RPC 호출": [
    "rpc.list_joinable_projects",
    "rpc.qa_impersonate_check_callable",
    "rpc.get_tbm_by_token_handles_missing",
  ],
  "스키마/RPC 드리프트 가드": ["drift.cols_projects", "drift.rpc_list_joinable_projects"],
  "보건 모듈": [
    "health.checkup_creates_todo",
    "health.hazard_survey_public_rpcs",
  ],
  "코어 12 기능 스모크": [
    "core12.risk_assessment_smoke",
    "core12.work_permit_smoke",
    "core12.approvals_smoke",
    "core12.tbm_smoke",
  ],
};

// 핵심 테이블별 필수 컬럼 (드리프트 감지용)
// 컬럼이 사라지거나 이름이 바뀌면 schema_drift 시나리오에서 FAIL.
export const REQUIRED_COLUMNS: Record<string, string[]> = {
  projects: ["id", "name", "status"],
  project_members: ["project_id", "user_id", "role_new", "company_id"],
  user_roles: ["user_id", "role"],
  profiles: ["user_id", "account_status", "display_name"],
  companies: ["id", "project_id", "name"],
  assessment_runs: ["id", "project_id", "type", "period_label", "status", "is_deleted"],
  risk_items: [
    "id",
    "project_id",
    "run_id",
    "process",
    "frequency",
    "severity",
    "risk_grade",
    "version_number",
    "status",
  ],
  work_plans: ["id", "project_id", "title", "work_type", "status", "version"],
  work_permits: [
    "id",
    "project_id",
    "work_plan_id",
    "permit_type",
    "work_name",
    "status",
  ],
  tbm_sessions: ["id", "project_id", "qr_token", "tbm_date", "is_active"],
  tbm_participations: ["id", "tbm_session_id", "worker_name", "worker_phone", "signature_data"],
  workers: ["id", "project_id", "name", "phone", "qr_token", "is_active"],
  worker_entry_logs: ["id", "worker_id", "project_id", "entry_at", "exit_at"],
  notifications: ["id", "user_id", "title", "message", "is_read"],
  audit_logs: ["id", "user_id", "action", "target_type", "target_id"],
};

// 핵심 RPC (이름이 바뀌거나 사라지면 즉시 감지)
export const REQUIRED_RPCS: Array<{ name: string; sample_args: any }> = [
  { name: "qa_impersonate_check", sample_args: { _target_user: "00000000-0000-0000-0000-000000000000", _project_id: "00000000-0000-0000-0000-000000000000" } },
  { name: "list_joinable_projects", sample_args: {} },
  { name: "get_tbm_by_token", sample_args: { _token: "__qa__" } },
  { name: "get_worker_by_token", sample_args: { _token: "__qa__" } },
  { name: "register_worker", sample_args: { _project_id: "00000000-0000-0000-0000-000000000000", _name: "", _phone: "", _company_name: "" } },
  { name: "submit_tbm_participation", sample_args: { _token: "__qa__", _worker_name: "", _worker_phone: "", _company_name: "", _briefing_confirmed: false, _signature_data: "", _ip_hash: "", _user_agent: "" } },
  { name: "worker_entry", sample_args: { _token: "__qa__", _work_permit_id: null, _signature: "", _ra_confirmed: false, _edu_confirmed: false, _tbm_confirmed: false } },
  { name: "worker_exit", sample_args: { _token: "__qa__", _signature: "", _no_accident: false } },
  { name: "process_invite_code", sample_args: { _user_id: "00000000-0000-0000-0000-000000000000", _invite_code: "__qa__" } },
];
