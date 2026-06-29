# Feature Card — 작업허가서 (Work Permit)

> 1차 사이클 #3. 마지막 검토: 2026-06-29

- 담당자: (미정)
- 관련 라우트: `/work-permits`, `/m/permits`
- 관련 테이블: `work_permits`, `work_permit_workers`, `confined_space_permits`
- 관련 RPC: `derive_permit_from_work_plan`, `submit_approval`, `act_on_entity_approval`
- 시나리오 키: `core12.work_permit_smoke`, `flow.create_work_permit`

---

## 1. Happy path ✅
- [x] 신규 발급 → 근로자 배정 → 결재 → 발효 → 종료
- [x] 작업계획서로부터 자동 파생(`derive_permit_from_work_plan`)
- 시나리오: `core12.work_permit_smoke`

## 2. Permission ✅
- [x] `useProjectAccess.can*('work_permit')` — 7역할 매트릭스 통과
- [x] safety_manager = 발급/승인/종료 가능 (master 동등, master 전용 메뉴 제외)
- 회귀: `src/test/permissions.matrix.test.ts`

## 3. Scope ✅
- [x] RLS: `work_permits` 4정책 (project + company 격리, `is_deleted=false`)
- [x] `work_permit_workers` — 같은 회사 근로자만 배정
- [x] 시공사 헤더 — 작성자 회사 우선

## 4. Empty / Loading / Error UI ⚠️
- [x] 0건 안내 카드 (`WorkPermits.tsx:241`)
- [x] 결재/반려 에러 시 토스트
- [ ] **남은 작업**: 발급 후 만료(expires_at) 임박 시 시각 경고 배지

## 5. Edge inputs ✅
- [x] `IMESafeInput`/`IMESafeTextarea` 사용
- [x] 작업 시간 zod 검증 (시작<종료)
- [x] 굴착/밀폐 등 특수허가 필수 항목 분기 (`DigPermitForm`, `confined_space_permits`)

## 6. State sync ✅
- [x] 결재완료 시 `work_permits.status='승인완료'` 미러
- [x] 사이드바 "결재함" 뱃지 합산 (`usePendingApprovalsCount`)
- [x] 배정 근로자 인앱 알림

## 7. Audit ✅
- [x] 발급/수정/종료/결재 — `audit_logs` 기록 (`useAuditLog`)
- [x] 삭제 시 reason 필수 (`WorkPermits.tsx:122`)

## 8. Rollback ✅
- [x] `useSoftDelete('work_permits')` — 휴지통 복원
- [x] 결재 반려 후 재상신 — 통합 결재 엔진 버저닝
- [x] 발효 중 허가서 강제 종료 가능 (이력 보존)

---

## 회귀 테스트 링크
- vitest: `src/test/permissions.matrix.test.ts` (work_permit 행)
- E2E: `SCENARIOS.core12.work_permit_smoke`, `SCENARIOS.flow.create_work_permit`

## 남은 작업
- 만료 임박(2h 이내) 시 목록·모바일에서 경고 배지 표시
- TBM 일지와 1:1 연동 확인 (`derive_tbm_from_work_plan` 경로와 통일)
