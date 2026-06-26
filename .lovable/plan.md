## 문제 요약

현재 부서·담당자 정보가 **3중으로 분리**되어 있어 화면마다 다른 목록이 나옵니다:

| 저장소 | 어디서 입력 | 어디서 조회 |
|---|---|---|
| `master_departments` + `master_assignees` | 관리자 페이지 (MasterData) | **위험성평가 일괄 모달**, 부서매핑 |
| `company_departments` + `company_managers` | **회사 관리 → 조직도/관리자** | CompanyDetail 만 |
| `project_members` | 사용자 초대 | 점검·비용·작업계획 등 모든 다른 메뉴 |

회사 조직도에 등록한 사람이 위험성평가에 나오지 않는 이유: 위험성평가 모달은 `master_departments` + `project_members` 만 읽고, `company_managers` 는 무시합니다. 통합 뷰(`project_assignee_pool`)도 만들었으나 부서매핑 화면 1곳만 사용 중입니다.

## 통합 방향 — 회사 관리(company_*)를 단일 진실(SSOT)로

**원칙**
- 부서 = `company_departments` (각 시공사·협력사가 자기 부서 관리)
- 사람 = `company_managers` (시스템 계정 연결은 선택)
- 프로젝트 접근 권한만 `project_members` 가 담당 (역할·로그인 ID)
- 모든 "담당자 지정" 드롭다운은 **단 하나의 뷰** `project_assignee_pool` 에서 읽음

**버릴 것**
- `master_assignees` — 사용처 1곳(MasterData), auth 연결 없음, 완전 폐기
- `master_departments` — 평가/매핑 UI 의 부서 소스에서 제거
- MasterData 페이지의 부서·담당자 탭 → "회사 관리"로 안내 후 제거

**유지·확장할 것**
- `company_departments` / `company_managers` — 입력 화면은 회사 상세만
- `project_assignee_pool` 뷰 — 모든 메뉴의 표준 데이터 소스
- `department_assignees` (부서→기본 담당자 매핑) — `department_id` 의 참조 대상을 `master_departments` → `company_departments` 로 전환

## 단계별 실행 계획

### Phase 1 — 데이터 마이그레이션 (DB)
1. `department_assignees.department_id` 를 `company_departments(id)` 참조로 전환 (FK 재지정).
2. 기존 `master_departments` 행을 각 프로젝트의 "기본 시공사" 의 `company_departments` 로 복사 (이름 기준 매핑, 중복 시 skip), 매핑 테이블의 ID를 새 ID로 교체.
3. `master_assignees` 의 이름·연락처를 해당 프로젝트의 "기본 시공사" `company_managers` 로 복사 (이미 같은 이름·전화 존재 시 skip).
4. `project_assignee_pool` 뷰에 `department_id`/`department_name` 컬럼이 이미 노출되어 있는지 확인 후 누락 시 보강.

### Phase 2 — UI 통합 (코드, master 제거)
1. `AssessmentRunDetail.tsx`
   - 행 단위 드롭다운(라인 239–259, ~2515, ~2532) 의 `master_departments`·`project_members` 직접 조회 제거.
   - 부서 = `company_departments` (현재 프로젝트 회사들), 담당자 = `useProjectAssigneePool` 로 일원화.
   - 일괄 모달의 부서·담당자 목록도 동일 소스로 교체.
2. `DepartmentAssigneeMapping.tsx`
   - 부서 소스를 `company_departments` 로 변경, `is_deleted=false` 필터 추가.
   - 시공사별로 그룹핑된 부서 트리 표시(여러 회사가 같은 이름의 부서를 가질 수 있음).
3. 다른 담당자 픽커가 있는 페이지(`SafetyInspections.tsx` 등) 도 점진적으로 `useProjectAssigneePool` 로 통일 (이번 Phase 는 위험성평가 우선, 나머지는 Phase 4).

### Phase 3 — Master 화면 정리
1. `MasterData.tsx` 의 "부서 관리" / "담당자 관리" 탭 제거 → 빈 자리에 "회사 관리로 이동" 버튼·안내.
2. 사이드바·라우터에서 해당 탭 접근 동선 정리.
3. RLS 로 `master_assignees` / `master_departments` 의 `INSERT`/`UPDATE` 차단(읽기는 한시 허용, 마이그레이션 검증용).

### Phase 4 — 잔여 메뉴 통일 & 정리
1. 점검·비용·TBM·작업계획 등 `project_members` 를 직접 픽커로 쓰는 곳을 `useProjectAssigneePool` 로 교체.
2. 검증 완료 후 `master_assignees` DROP, `master_departments` DROP(또는 deprecated 표식 후 다음 릴리스에 DROP).

### Phase 5 — 검증
1. 시드 시나리오: 회사 조직도에 부서·담당자 등록 → 위험성평가 일괄 모달과 행 드롭다운에 즉시 노출되는지 확인.
2. `company_managers.user_id` 가 비어 있어도(아직 가입 안 한 사람) 위험성평가 담당자로 선택 가능한지 확인.
3. 기존 위험성평가 데이터의 담당자 표시가 깨지지 않는지(이미 저장된 user_id 가 풀에 존재하는지) 회귀 확인.

## 사용자 경험 변화

- "회사 관리 → 조직도/관리자" 에 한 번 등록하면 **위험성평가·TBM·점검·비용 등 모든 메뉴의 담당자 드롭다운**에 자동 노출.
- 마스터 데이터의 "부서/담당자" 탭은 사라지고, 모든 입력은 회사 단위로만.
- 아직 시스템 계정이 없는 협력업체 담당자도 풀에 떠서 선택 가능 (감사로그·알림은 user_id 가 연결된 후 동작).

## 확인 필요

1. **Phase 1 의 자동 복사** — 현재 `master_departments`/`master_assignees` 의 기존 데이터를 어느 시공사 밑으로 이전할지 자동 매핑이 어렵다면, 마이그레이션을 건너뛰고 "기존 데이터는 보존하되 신규 화면은 회사 데이터만" 으로 갈 수도 있습니다. 자동 이전 vs 신규부터 시작 중 선호하시는 방향?
2. **Phase 4 의 범위** — 점검/비용/TBM 등 다른 메뉴까지 이번에 한꺼번에 통합할지, 위험성평가만 먼저 적용 후 단계적으로 갈지?
