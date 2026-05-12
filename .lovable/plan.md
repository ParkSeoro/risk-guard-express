## 목표

1. **메뉴 산개 해소** — 30개 가까운 메뉴를 5개 그룹으로 재편해 신규 사용자가 작업 흐름을 직관적으로 파악
2. **빠른 시작 진입점** — 대시보드 상단에 "다음 할 일" 카드 3~4개로 첫 행동 유도
3. **공통 법칙 일관성 감사** — 모든 페이지/기능이 프로젝트 공통 규칙을 따르는지 점검 보고서

---

## Phase 1 — 사이드바 재편 (5 그룹)

기존 6 그룹(안전관리/점검·교육/근로자/비용·법적/운영/시스템) → 사용자 작업 흐름 기반 5 그룹.

### 새 그룹 구조

```text
[ 홈 ]
  └ 대시보드 (Quick Start 카드 포함)

[ 현장 작업 ]                  ← 작업 시작 전 문서 흐름
  ├ 작업계획서
  ├ 작업허가서
  ├ TBM 일지
  └ 현장 적용 체크

[ 위험관리 ]                   ← 위험 식별/검증/평가
  ├ 위험성평가
  ├ 검증센터
  └ AI 어시스턴트

[ 안전점검 ]                   ← 사용자 요청대로 별도 유지
  └ 안전점검
  └ 감독 대응(점검모드)
  └ 교육자료

[ 인력·비용·법적 ]             ← 관리 영역 통합
  ├ 근로자 관리 (입퇴장 현황은 내부 탭)
  ├ 산업안전보건관리비
  └ 법적업무

[ 운영 ]                       ← "내가 처리할 일"
  ├ 할 일
  ├ 결재함
  ├ 프로젝트
  └ 현장 일기예보

[ 시스템 ]                     ← 관리자
  ├ 기준정보
  ├ 설정
  ├ 권한 점검
  ├ 감사 로그
  ├ 사용 설명서
  └ (Master) AI 테스트/AI 로그/시스템 테스트
```

> 실제로는 7 블록이지만 시각적 중요도로 상위 5개(홈·현장작업·위험관리·안전점검·인력비용)를 메인, 운영·시스템은 하단 구분선 아래 보조 영역으로 배치해 "5+보조" 느낌으로 단순화.

### 페이지 통합 변경

- **근로자 관리 + 입퇴장 현황** → `/workers` 한 페이지에 탭 2개(`등록 정보` / `입퇴장`)로 통합. 라우트는 둘 다 유지(리다이렉트).
- `MobileRedirectGuard`, 라우트(`App.tsx`), localStorage 그룹 키(`sidebar:groups` 기본값) 동기화.
- 기존 URL은 그대로 살리고 `AppSidebar.tsx`의 `groups` 배열만 재구성.

---

## Phase 2 — 대시보드 Quick Start 카드

대시보드(`/`) 상단에 역할별 3~4개 카드. 신규 사용자가 즉시 다음 행동을 클릭 가능.

- **현장소장/PM**: "오늘 결재 대기 N건" / "위험성평가 작성" / "작업계획서 작성" / "안전점검 계획"
- **협력사(contractor)**: "내 회사 위험성평가" / "작업허가서 신청" / "TBM 일지 작성"
- **Master**: "프로젝트 전체 현황" / "사용자 관리" / "감사 로그"

`useProjectAccess`의 `userRole`로 분기. 카드는 아이콘 + 제목 + 한 줄 설명 + 카운트 배지.

---

## Phase 3 — 공통 법칙 일관성 감사 보고서

코드만 점검하고 결과를 `/admin/system-test` 또는 새 페이지 `/admin/consistency-audit`에 매트릭스로 출력. **이번 단계에서는 보고서 생성까지만 하고, 누락 부분 수정은 별도 작업으로 분리.**

### 점검 항목 (체크리스트)

| # | 공통 법칙 | 메모리 출처 | 점검 방법 |
|---|---|---|---|
| 1 | `useProjectAccess`로 회사/역할 격리 | logic/project-access-hook | 페이지별 import 여부 grep |
| 2 | 소프트 삭제 (`is_deleted` 컬럼) | system/soft-delete-policy | 주요 테이블 컬럼 존재 + UI 필터 적용 확인 |
| 3 | 5단계 승인 워크플로우 | auth/approval-workflow | approval_requests FK 가진 테이블 식별 |
| 4 | `IMESafeInput` 한글 입력 | tech/ime-stability | 폼 페이지에서 `<Input` vs `<IMESafeInput` 비율 |
| 5 | 감사 로그(audit) 기록 | features/audit-tracking | CRUD 핸들러에서 `useAuditLog` 호출 여부 |
| 6 | Zod 검증 | tech/data-validation | 폼 submit 핸들러의 schema.parse 사용 여부 |
| 7 | 프로젝트별 첨부 격리 | features/evidence-attachments | storage path에 projectId 포함 여부 |
| 8 | 용어 표준화 | system/terminology-standardization | 입력 onChange에 termCorrection 적용 |
| 9 | 에러 무음 금지 | system/error-handling-policy | catch 블록의 toast 호출 |
| 10 | 결재 후 수정 시 사유 | logic/approved-document-handling | 수정 다이얼로그의 reason 필드 |

### 대상 페이지 (스코프)
주요 18개: RiskAssessment, AssessmentRunDetail, WorkPlans, WorkPlanDetail, WorkPermits, TbmLogs, SafetyInspections, SiteReadinessChecklist, VerificationCenter, EducationMaterials, WorkerManagement, WorkerAttendance, SafetyCost, LegalDuties, TodoDashboard, Approvals, MasterData, Settings.

### 산출물
- `/admin/consistency-audit` 페이지 — 페이지×법칙 매트릭스 (✓/✗/N/A + 클릭 시 해당 파일·라인 표시)
- Master 전용
- 자동 스캔이 어려운 항목(예: termCorrection 적용 여부)은 수동 마킹 가능

---

## 기술 세부사항

### 변경 파일
- `src/components/AppSidebar.tsx` — `groups` 배열 재구성, `openGroups` 기본값 변경
- `src/pages/Dashboard.tsx` — 상단 Quick Start 섹션 추가 (역할별 카드)
- `src/pages/WorkerManagement.tsx` — 탭 추가 (`등록정보` / `입퇴장`), `WorkerAttendance.tsx` 콘텐츠 흡수
- `src/App.tsx` — `/worker-attendance` 라우트는 `/workers?tab=attendance`로 리다이렉트 유지
- `src/pages/ConsistencyAudit.tsx` (신규) — 감사 매트릭스 페이지
- `src/lib/consistencyAudit.ts` (신규) — 정적 점검 룰 + 페이지 메타데이터
- 사이드바에 `시스템 > 일관성 감사` 메뉴 추가 (Master 전용)

### 변경하지 않을 것
- DB 스키마 (감사는 읽기 전용)
- 기존 페이지 비즈니스 로직
- 라우트 경로 (이전 링크 호환을 위해 모두 유지, 리다이렉트만 추가)

### 검증
- 빌드 통과
- 사이드바 토글 시 그룹 펼침/접힘 정상
- 대시보드 카드가 역할별로 다르게 표시되는지 console 로그로 확인
- `/admin/consistency-audit`에 매트릭스가 렌더되고 결과가 합리적인지 시각 검수

---

## 예상 결과

- 사이드바 항목 28개 → 7 그룹 × 평균 3~4개로 시각적 밀도 감소
- 첫 방문 사용자가 대시보드에서 즉시 클릭할 진입점 확보
- Master가 시스템 일관성을 한 화면에서 점검 → 후속 정리 작업의 백로그가 됨