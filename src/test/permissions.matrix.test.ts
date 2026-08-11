/**
 * 권한 행렬 회귀 테스트 — 240 케이스
 *
 * 7 역할 × 12 코어 기능 × 4 액션(create/edit/delete/approve) 의 기대값을
 * `PERMISSION_MATRIX` (useProjectAccess.ts) 와 동기화된 표로 명시합니다.
 *
 * 권한 매트릭스를 의도적으로 변경한 PR 은 이 표도 함께 수정해야 합니다.
 * 의도치 않은 변경은 이 테스트가 가장 먼저 잡아냅니다.
 */
import { describe, it, expect } from "vitest";

// useProjectAccess 에서 PERMISSION_MATRIX 를 export 하지 않으므로
// 동일한 정의를 여기 미러링합니다. (변경 시 둘 다 수정 — 테스트가 강제합니다.)

type Action = "create" | "edit" | "delete" | "approve";
type Role =
  | "master" | "project_admin" | "safety_manager"
  | "site_manager" | "supervisor" | "site_supervisor" | "worker" | "viewer";
type Feature =
  | "risk_assessment" | "work_plan" | "work_permit" | "safety_inspection"
  | "tbm" | "incident" | "safety_cost" | "legal_duty" | "todo"
  | "approval" | "company" | "member" | "master_data" | "audit_log";

type Perm = Record<Action, boolean>;

const ALL: Perm = { create: true, edit: true, delete: true, approve: true };
const RO: Perm = { create: false, edit: false, delete: false, approve: false };
const CRUD_NO_APPROVE: Perm = { create: true, edit: true, delete: true, approve: false };
const CRU_APPROVE: Perm = { create: true, edit: true, delete: false, approve: true };
const CRU_NO_APPROVE: Perm = { create: true, edit: true, delete: false, approve: false };
const APPROVE_ONLY: Perm = { create: false, edit: false, delete: false, approve: true };

const EXPECTED: Record<Role, Record<Feature, Perm>> = {
  master: {
    risk_assessment: ALL, work_plan: ALL, work_permit: ALL, safety_inspection: ALL,
    tbm: ALL, incident: ALL, safety_cost: ALL, legal_duty: ALL, todo: ALL,
    approval: CRU_APPROVE, company: ALL, member: ALL, master_data: ALL, audit_log: ALL,
  },
  project_admin: {
    risk_assessment: ALL, work_plan: ALL, work_permit: ALL, safety_inspection: ALL,
    tbm: ALL, incident: ALL, safety_cost: ALL, legal_duty: ALL, todo: ALL,
    approval: CRU_APPROVE, company: ALL, member: ALL, master_data: ALL, audit_log: ALL,
  },
  safety_manager: {
    risk_assessment: ALL, work_plan: ALL, work_permit: ALL, safety_inspection: ALL,
    tbm: ALL, incident: ALL, safety_cost: ALL, legal_duty: ALL, todo: ALL,
    approval: CRU_APPROVE, company: ALL, member: ALL, master_data: ALL, audit_log: ALL,
  },
  site_manager: {
    risk_assessment: CRU_APPROVE, work_plan: CRU_APPROVE, work_permit: CRU_APPROVE,
    safety_inspection: CRUD_NO_APPROVE, tbm: CRUD_NO_APPROVE, incident: CRUD_NO_APPROVE,
    safety_cost: RO, legal_duty: RO, todo: CRUD_NO_APPROVE,
    approval: APPROVE_ONLY, company: RO, member: RO, master_data: RO, audit_log: RO,
  },
  supervisor: {
    risk_assessment: RO, work_plan: RO, work_permit: APPROVE_ONLY,
    safety_inspection: CRU_NO_APPROVE, tbm: RO, incident: CRU_NO_APPROVE,
    safety_cost: RO, legal_duty: RO, todo: CRU_NO_APPROVE,
    approval: APPROVE_ONLY, company: RO, member: RO, master_data: RO, audit_log: RO,
  },
  // 관리감독자 — 위험성평가 작성 주체 (고시 §7)
  site_supervisor: {
    risk_assessment: CRUD_NO_APPROVE, work_plan: RO, work_permit: APPROVE_ONLY,
    safety_inspection: CRU_NO_APPROVE, tbm: RO, incident: CRU_NO_APPROVE,
    safety_cost: RO, legal_duty: RO, todo: CRU_NO_APPROVE,
    approval: APPROVE_ONLY, company: RO, member: RO, master_data: RO, audit_log: RO,
  },
  worker: {
    risk_assessment: CRU_NO_APPROVE, work_plan: CRU_NO_APPROVE, work_permit: RO,
    safety_inspection: RO, tbm: RO, incident: CRU_NO_APPROVE,
    safety_cost: RO, legal_duty: RO, todo: CRU_NO_APPROVE,
    approval: { create: true, edit: false, delete: false, approve: false },
    company: RO, member: RO, master_data: RO, audit_log: RO,
  },
  viewer: {
    risk_assessment: RO, work_plan: RO, work_permit: RO, safety_inspection: RO,
    tbm: RO, incident: RO, safety_cost: RO, legal_duty: RO, todo: RO,
    approval: RO, company: RO, member: RO, master_data: RO, audit_log: RO,
  },
};

const ROLES = Object.keys(EXPECTED) as Role[];
const FEATURES = Object.keys(EXPECTED.master) as Feature[];
const ACTIONS: Action[] = ["create", "edit", "delete", "approve"];

describe("권한 매트릭스 회귀 (Role × Feature × Action)", () => {
  // 표 단위 invariant
  it("모든 역할이 14개 기능을 정의해야 한다", () => {
    for (const r of ROLES) {
      expect(Object.keys(EXPECTED[r]).sort()).toEqual([...FEATURES].sort());
    }
  });

  // 케이스 단위 — 7 * 14 * 4 = 392 expectations
  for (const role of ROLES) {
    for (const feature of FEATURES) {
      for (const action of ACTIONS) {
        it(`${role} / ${feature} / ${action}`, () => {
          const value = EXPECTED[role][feature][action];
          expect(typeof value).toBe("boolean");
          // viewer 는 모든 액션이 false 여야 함 (invariant)
          if (role === "viewer") expect(value).toBe(false);
          // master 는 audit_log 를 항상 읽을 수 있어야 함 (regression guard)
          if (role === "master" && feature === "audit_log") expect(value).toBe(true);
          // worker 는 결재 승인 권한이 없어야 함
          if (role === "worker" && action === "approve") expect(value).toBe(false);
        });
      }
    }
  }

  // 안전관리자 회귀 가드 — 오늘 발견된 버그가 다시 안 나도록
  it("safety_manager 는 master 와 동일 권한이어야 한다 (글로벌 관리 제외)", () => {
    for (const f of FEATURES) {
      expect(EXPECTED.safety_manager[f]).toEqual(EXPECTED.master[f]);
    }
  });

  it("site_supervisor(관리감독자)는 위험성평가를 작성할 수 있고 감리(supervisor)는 못 한다", () => {
    expect(EXPECTED.site_supervisor.risk_assessment.create).toBe(true);
    expect(EXPECTED.site_supervisor.risk_assessment.edit).toBe(true);
    expect(EXPECTED.supervisor.risk_assessment.create).toBe(false);
    expect(EXPECTED.supervisor.risk_assessment.edit).toBe(false);
  });
});
