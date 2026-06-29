# 안정화 스프린트 플랜 (신규 기능 동결)

목표: **"기능을 더 만들지 않고, 지금 있는 것을 신뢰할 수 있게 만든다."** 대기업 적용 가능 수준의 정합성·권한·결재·오프라인 안정성을 확보합니다. 약 2~3주 분량, 4개 트랙으로 진행하며, 각 트랙은 독립 배포 가능합니다.

---

## 트랙 1. 데이터 정합성 SSOT 통합 (가장 시급)

지금 부서·담당자 관련 테이블이 4개(`master_departments`, `company_departments`, `department_assignees`, `company_managers`) 공존하면서 FK 오류와 매핑 누락이 반복되고 있습니다.

**작업**
1. SSOT 선언: `company_departments` + `company_managers` 를 **유일 정답**으로 확정. `master_departments`, `department_assignees`, `master_assignees` 는 **읽기 전용 레거시**로 마킹.
2. 데이터 마이그레이션: 레거시 테이블에만 존재하는 부서/담당자를 SSOT로 복제. 중복 키는 회사 ID 우선.
3. 모든 FK 정리: `risk_items.responsible_department_id`, `risk_items.assignee_user_id`, `work_plans.*`, `safety_inspections.*`, `incident_reports.*` 등 담당자·부서 참조 컬럼을 **자유 텍스트 FK 미설정** 상태에서 **SSOT 테이블에 대한 부분 FK(`ON DELETE SET NULL`)** 로 재정의.
4. `useProjectAssigneePool` 훅을 SSOT 단일 소스로 재작성. 모든 `AssigneeSelect`, `DepartmentAssigneeMapping` 컴포넌트가 이 훅만 사용하도록 통합.
5. 정합성 점검 RPC `audit_data_consistency()` 추가: 고아 레코드·이중 매핑·FK 깨짐을 한 화면(`/admin/data-audit`)에서 조회·자동 보정.

**검증**
- 위험성평가 일괄 책임자 지정 → 작업계획서 → TBM → 점검 4개 화면에서 동일한 담당자 풀이 나오는지 E2E.

---

## 트랙 2. 권한 단일화

현재 권한 체크가 `useProjectAccess`, `is_project_admin` RPC, 페이지별 `role===…`, `SettingsPermissions` 의 site override 4곳에 분산되어 있어 "안전관리자" 같은 변경이 매번 누락됩니다.

**작업**
1. 권한 매트릭스 정의 표를 `mem://auth/permission-matrix` 에 확정 (역할 × 기능 × CRUD).
2. DB 함수 `has_permission(_user_id, _project_id, _resource, _action)` 신설. 매트릭스를 SQL 로 1회 인코딩.
3. 모든 RLS 정책에서 산발적 `role IN (...)` 체크를 `has_permission()` 호출로 치환.
4. 프론트 `useProjectAccess` 를 매트릭스 기반으로 재작성하여 `can(resource, action)` 단일 API 노출.
5. `SettingsPermissions.tsx` 는 매트릭스 override 만 담당(컴포넌트별 if 분기 제거).
6. 권한 회귀 테스트: 역할 5종 × 핵심 메뉴 20개 = 100건 행렬을 vitest 로 자동 검증.

---

## 트랙 3. 결재 워크플로 신뢰성

결재가 여전히 위험성평가·작업계획서·작업허가서·안전비용에서 각자 구현되고 있고, 반려·재상신·버전 추적이 일관되지 않습니다.

**작업**
1. **단일 결재 엔진** 으로 통합: `approvals` + `approval_lines` 테이블을 모든 도큐먼트의 정답으로 확정. 도큐먼트별 자체 컬럼(`work_plans.approval_status` 등) 은 결재 엔진의 미러로만 유지.
2. RPC 정리: `approval_submit / approve / reject / cancel / delegate / resubmit` 6개 함수만 노출. 페이지별 직접 UPDATE 금지.
3. 재상신 버저닝: `resubmission_version` 자동 증가, 직전 라인 자동 취소, 첨부 스냅샷 보존.
4. 반려 시 필수 사유 + 작성자에게 푸시·이메일 강제.
5. `/approvals` 페이지를 진짜 통합 인박스로 (지금은 일부 도큐먼트만 표시). 위임/대기/지연 필터 포함.
6. `SubmitApprovalDialog` 1개로 모든 도큐먼트가 결재 상신 (현재는 일부 페이지만 사용).

---

## 트랙 4. 모바일/오프라인 안정성

근로자 앱이 출퇴근·TBM·작업중지의 핵심 채널인데, 오프라인 큐(`useOfflineSync`, `offlineQueue`) 의 충돌 처리·재시도가 검증되지 않았습니다.

**작업**
1. 오프라인 큐 스키마 명세화: 모든 모바일 mutation 을 `{op, table, payload, idempotency_key, attempts}` 로 표준화.
2. 서버측 멱등성: 모든 mobile-facing RPC 에 `idempotency_key` 파라미터 + UNIQUE 인덱스. 중복 출근 체크·중복 TBM 서명 자동 무시.
3. 충돌 해결 정책 명문화: "마지막 쓰기 승" vs "서버 우선" 을 테이블별로 결정 (출근=서버, 서명=클라).
4. 백그라운드 위치 추적 헬스 대시보드 (`/admin/tracking-health`) 에 디바이스별 마지막 동기화 시각·실패율 KPI 표시.
5. OTA 업데이트 롤백 버튼 추가 (마스터 전용). 잘못된 빌드 배포 시 1클릭 이전 버전 복귀.
6. Playwright E2E 시나리오 3개: 오프라인 출근 → 온라인 복귀 동기화 / TBM 다중 서명 충돌 / 작업중지 요청 큐잉.

---

## 횡단 작업 (모든 트랙 공통)

- **회귀 테스트 인프라**: 위 4개 트랙 각각의 핵심 시나리오를 `src/lib/systemTest/scenarios.ts` 에 추가, `/admin/system-test` 에서 1클릭 실행. CI 에서 매 배포 전 자동 실행.
- **에러 가시화**: 모든 RPC 호출에 `useToastError` 강제. silent fail 정적 검사를 ESLint 룰로 추가.
- **변경 영향 분석 문서**: 각 트랙 완료 시 `docs/stabilization/{track}.md` 에 변경 표·롤백 절차 기록.

---

## 진행 순서 (제안)

```text
주차 1 :  트랙 1 (정합성)   ────────►  배포 + 회귀 검증
주차 2 :  트랙 2 (권한)     ────────►  배포 + 권한 행렬 테스트
주차 3 :  트랙 3 (결재)     ────►
          트랙 4 (모바일)   ────►     병렬 진행 후 통합 배포
```

각 트랙은 **신규 기능 0개**, 기존 동작은 100% 호환을 원칙으로 합니다. 사용자가 새로 요청하시는 기능은 안정화 스프린트 종료 후 별도 큐로 받습니다.

---

## 첫 단계로 무엇부터 시작할지

승인하시면 **트랙 1 (데이터 정합성 SSOT 통합)** 의 1단계 — SSOT 마이그레이션 SQL 과 `audit_data_consistency()` RPC, `/admin/data-audit` 페이지 — 부터 즉시 착수합니다. 트랙 1 이 완료되어야 트랙 2·3 의 RLS 재작성이 의미가 있기 때문입니다.