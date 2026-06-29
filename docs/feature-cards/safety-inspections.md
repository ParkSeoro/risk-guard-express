# Feature Card — 안전점검 / 조치관리 (#14)

법적 근거: 산안법 §36 (작업환경 점검), §38 (안전조치), §63 (도급사업 합동점검), 시행규칙 §35 (점검결과 기록 보존 3년).

## Scope
- `/safety-inspections` (SafetyInspections.tsx) — 통합 점검 콘솔
- `/m/inspect` (MobileInspect.tsx) — 모바일 현장 점검
- `/inspection-mode` (InspectionMode.tsx) — 전체화면 점검 모드
- 테이블: `safety_inspections`, `safety_inspection_items`, `safety_inspection_actions`

## 8-Dim Checklist
1. Happy path — 점검생성 → 체크리스트 자동 생성(`buildChecklist`) → 통과/불합격/해당없음 표시 → 불합격시 조치 자동 생성 → 증빙사진 첨부 → 조치완료 → 점검완료.
2. Permission — 작성/수정은 점검자 본인, 처리는 master/project_admin/safety_manager. 시공사는 본인 회사 점검만 조회(RLS+MultiCompanyFilter).
3. Scope — `project_id` 필터 + RLS. `is_deleted=false`. 삭제된 점검의 조치는 actions 탭에서 제외.
4. Empty/Loading — Skeleton 4행 + "점검 기록이 없습니다" CTA. 미조치 0건시 성공 메시지.
5. Edge inputs — 위치 검색, 점검자 검색, 공종 검색, 상태 필터(전체/진행중/완료). 사진 미첨부시 조치완료 차단.
6. State sync — 결과 변경시 즉시 로컬+DB 동기화, 불합격→조치 자동 생성 + safety_manager 알림 발송.
7. Audit — 점검 생성/완료/삭제, 조치 처리에 audit_logs 적재(개선 필요시 추가).
8. Rollback — 소프트삭제(is_deleted), 휴지통(/admin/trash)에서 복원. 점검 결과 변경 이력은 item의 마지막 상태만 보존.

## UX 강화
- 검색: 위치/점검자/공종
- 상태 필터(진행중/완료/전체) + 회사 필터
- 미조치 항목 D-Day 배지(`D-3`, `D-Day`, `D+5 초과`)
- Skeleton 로딩
- 점검표 인쇄/PDF 출력(법적 근거 포함)
- 자동 알림(불합격 발생시 안전관리자에게)
