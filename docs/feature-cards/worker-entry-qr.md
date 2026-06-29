# Feature Card #18 — 근로자 출입 / QR 스캔

대상: `worker_entry_logs`, `company_daily_qr`, `worker_daily_qr`, `zone_qr_codes` + `WorkerAttendance.tsx` / `CompanyScan.tsx` / `ZoneCheckin.tsx`

## 1. Happy Path
- 각 시공사 관리자가 매일 `company_daily_qr` 을 발급(인쇄·게시) → 근로자가 출근 시 QR 스캔.
- 스캔으로 위험성평가/교육/TBM/무재해 확인 → `worker_entry_logs` 에 입장 기록.
- 퇴근 시 재스캔으로 `exit_at` 채움 → 일자별 입퇴장 현황·CSV 출력으로 보고.

## 2. Permission
- 입퇴장 조회: 같은 회사 데이터로 자동 격리(`useProjectAccess`).
- `master` / `project_admin` / `safety_manager` 는 전체 회사 열람 가능.
- QR 발급·게시: 시공사 관리자, 안전관리자, 마스터.

## 3. Scope
- `project_id` + 날짜 범위(`entry_at` BETWEEN 00:00~23:59)로 RLS·쿼리 동시 적용.
- 비-마스터/안전관리자는 자기 `company_name` 기록만 표시.

## 4. Empty / Loading
- 로딩 중 Skeleton 행 5개.
- 데이터 없음 vs 필터 결과 없음 메시지 분리.

## 5. Edge Inputs
- 회사명 미지정·근로자 매핑 실패 → "—" 처리(스킵 X).
- 미완 확인(위험/교육/TBM) 행은 destructive 배지 + 행 배경 강조.

## 6. State Sync
- 날짜·프로젝트 변경 시 즉시 재조회. 카운터·시공사 옵션은 결과 기반 `useMemo`.

## 7. Audit
- `worker_entry_logs` 는 입퇴장 추적용으로 변경/삭제 시 audit 트리거 대상(공통 SSOT 정책).

## 8. Rollback
- 잘못된 스캔은 마스터가 `/admin/trash` 또는 직접 보정 가능(소프트 삭제 적용).

## 추가 개선
- KPI 카드: 입장중 / 퇴장 / 확인미완 / 무재해 서명 수.
- 상태 탭(`전체/입장중/퇴장/확인미완`) + 검색(이름·전화·소속) + 시공사 셀렉트.
- CSV 출력은 필터 결과 기준으로 다운로드.
