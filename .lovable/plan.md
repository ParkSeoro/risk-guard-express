# 산업안전보건법 기반 통합 안전관리 체계 완성

기존 시스템·권한·결재 구조를 유지하면서 6개 영역을 단계적으로 추가/개편합니다. 범위가 크므로 **Phase 단위로 나눠** 진행하며, 각 Phase 완료 후 동작 확인 후 다음으로 진행합니다.

---

## Phase 1 — 사이드바 구조 개편 (즉시, UI만)
`src/components/AppSidebar.tsx` 를 그룹형 메뉴로 재구성합니다. 라우트는 기존 유지, 신규 라우트(점검/사고/교육)는 placeholder 페이지로 먼저 등록.

그룹:
- **안전관리**: 위험성평가 / TBM 일지 / 작업계획서 / 작업허가서
- **점검/교육**: 안전점검(신규) / 교육관리(신규) / TBM 일지
- **사고/개선**: 사고관리(신규) / 아차사고(신규) / 개선조치(검증센터 매핑)
- **비용/법적**: 산업안전보건관리비 / 법적업무
- **운영**: 할 일 / 결재함 / 현장 적용 체크 / 감독 대응 / 현장 일기예보 / AI 어시스턴트
- **시스템**: 프로젝트 / 기준정보 / 감사 로그 / 권한 점검 / 설정

기능: 그룹 접기/펼치기(Collapsible), 권한 기반 필터(useProjectAccess), 최근 사용 메뉴(localStorage top 5).

---

## Phase 2 — 법적 안전점검 시스템 (핵심)

### DB (migration)
- `safety_inspections` (project_id, company_id, type[`pre_work`|`during_work`|`weekly`|`monthly`|`special`|`patrol`], process_category, inspector_id, inspected_at, location, summary, status, created_by, is_deleted)
- `safety_inspection_items` (inspection_id, checklist_code, label, legal_basis, result[`pass`|`fail`|`na`], note, photos jsonb)
- `safety_inspection_actions` (inspection_id, item_id, issue, severity, assignee_id, due_date, status[`pending`|`in_progress`|`done`], evidence_photos jsonb, completed_at, completed_by)
- RLS: 프로젝트 멤버 조회, 회사 격리, 작성자/Master 수정.

### 페이지: `src/pages/SafetyInspections.tsx`
- 점검 유형 선택 → 공종 선택 → **체크리스트 자동 생성** (`src/lib/inspectionTemplates.ts` 신규: 공종×유형별 법적 필수 항목 매핑).
- 항목별 결과/사진/비고 입력 (`attachments` 버킷 사용).
- Fail 항목은 즉시 **조치 요청 자동 생성** → 담당자 지정.
- 조치 화면: 상태 변경 시 **증빙 사진 필수 검증**.
- 미조치 항목은 대시보드/할일/감독대응 모드에 자동 표시.
- **PDF/인쇄**: A4, Malgun Gothic, 점검표 + 사진 그리드 + 조치 요약 (기존 `printTbmLog` 패턴 재사용).

---

## Phase 3 — 사고 / 아차사고 관리
### DB
- `safety_incidents` (project_id, company_id, type[`accident`|`near_miss`], occurred_at, location, description, cause_analysis, recurrence_prevention, severity, photos jsonb, linked_run_id, status, is_deleted)

### 페이지: `src/pages/Incidents.tsx`
- 사고/아차사고 분리 탭, 원인분석·재발방지 필드.
- **연동**: 사고 등록 시 해당 공종 위험성평가에 "사고 이력 반영" 플래그 + 관련 점검 체크리스트 항목 강화(가중치).
- 기존 `accident_cases` 자동 추천 로직과 연결 (`src/components/AccidentPrediction.tsx`).

---

## Phase 4 — 교육관리
### DB
- `safety_trainings` (project_id, title, type[`legal`|`special`|`tbm`|`new_worker`], training_date, duration_hours, trainer, materials jsonb, is_deleted)
- `safety_training_attendances` (training_id, worker_name, worker_phone, company_id, signature_data, attended)

### 페이지: `src/pages/Trainings.tsx`
- 법정 교육 등록, 참석자 서명/기록.
- **작업 통제 연동**: 작업허가서 실행 가능 조건에 `교육 이수` 추가 (Phase 6).

---

## Phase 5 — 법적업무 자동 관리 강화
기존 `LegalDuties` 확장:
- Daily/Weekly/Monthly 구분 필터.
- 오늘 할 일 자동 집계 → `TodoDashboard` 카드 추가.
- TBM/점검/교육이 의무로 자동 생성되도록 트리거(클라이언트 자동 시드).

---

## Phase 6 — 작업 통제 게이트 확장
`src/pages/WorkPermits.tsx` `exec_ok` 계산에 다음 추가:
- 당일 안전점검(pre_work) 완료
- 작업자 법정교육 이수 상태(회사/공종 단위)

미충족 시 "작업 불가" 배지 + 사유 표시.

---

## 기술 메모
- 모든 신규 테이블 RLS: `is_project_member` + `can_access_safety_cost` 패턴 재사용.
- 사진 업로드: 기존 `attachments` 버킷, `project_id/feature/...` 경로.
- PDF: 클라이언트 `window.print()` + Malgun Gothic 인라인 스타일 (기존 TBM 패턴).
- IME: 모든 텍스트 입력은 `IMESafeInput` 사용.
- Term: `산업안전보건관리비`, `굴착기` 등 `termCorrection` 적용.

---

## 진행 방식
범위가 매우 크므로 **Phase 1(사이드바) → Phase 2(안전점검) 우선 구현** 후 작동 확인 받고 Phase 3~6 순차 진행합니다.

진행해도 될까요? 또는 우선순위를 바꾸고 싶은 Phase가 있으면 알려주세요.
