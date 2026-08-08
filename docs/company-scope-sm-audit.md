# Company scope audit — safety_manager ≠ project-wide

SSOT: `src/lib/companyDocScope.ts`

| 회사 유형 | PA / SM | 범위 |
|-----------|---------|------|
| 발주처 (client) | PA·SM | **전체** |
| 시공사 (gc) | PA·SM·소장 등 | **자사 + 하위** (tree) |
| 협력사/공급사 | 역할 무관 | **자사만** |

발주·시공·협력 **각각** 안전관리자가 있다. `role_new === 'safety_manager'` 만으로 전체 조회하면 안 된다.

## Root smell

`useProjectAccess.isProjectAdmin` / `useMobileAccess.isProjectAdmin` 이
`project_admin | master | safety_manager` 를 묶어 **기능 ACL** 용으로 쓰인다.
회사 데이터 가시성에 이 플래그를 쓰면 시공/협력 SM까지 전체가 열린다.

**회사 가시성 SSOT:** `accessibleCompanyIds === null` / `seesAllCompanies` / `applyCompanyFilter`.

## Fixed in this pass

- `WorkerEducation`, `WorkerAttendance`, `Chemicals` write/picker
- `CompanyDetail` canEdit, `SafetyCost` scoped lists, `SafetyCostValidationPanel`
- `AssessmentRunDetail` GC label, `Dashboard` showOpsWide, `Trash` row filter, `WorkPlans` company picker
- Helper `seesProjectWideCompanies` + hook `seesAllCompanies`

## Remaining (permission / medium — not auto-fixed)

| 위치 | 메모 |
|------|------|
| `WorkPermits` / `MobilePermits` `isPermitAdmin` | draft 가시성 확장 — 회사 필터는 쿼리에 있음 |
| `Approvals` withdraw `isProjectAdmin` | 권한 버튼 |
| `WorkStopRequests` canHandle | 프로젝트 단위 테이블 |
| `Settings*` SM 카드 | 설정 접근 |
| DB `can_access_safety_cost` | 서버 RLS가 PA+SM을 타입 없이 true — 후속 |
| `HealthDashboard` 집계 | RLS 의존 — 후속 |

## Rule for new code

```ts
// BAD
if (isMaster || isProjectAdmin || isSafetyManager) /* see all */

// GOOD
if (seesAllCompanies) /* see all */
else applyCompanyFilter(q) // or .in('company_id', accessibleCompanyIds!)
```
