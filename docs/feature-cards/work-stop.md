# Feature Card — 작업중지권 / 근로자 의견 (#13)

법적 근거: 산안법 §54 (작업중지권), §54-2 (불이익 처우 금지), 위험성평가 고시 §11 (근로자 참여 의견).

## Scope
- `/work-stop` — 관리자 처리 콘솔 (WorkStopRequests.tsx)
- `/m/work-stop` — 모바일 근로자 신고 (MobileWorkStop.tsx, OTP 기반)
- `worker_opinions` — 위험성평가(run) 내 근로자 의견은 AssessmentRunDetail > WorkerParticipationPanel 에서 수집/표시

## 8-Dim Checklist
1. Happy path — 모바일에서 신고 → 콘솔 접수 → 확인중 → 조치완료(재개시각 자동 기록).
2. Permission — 처리(상태 변경)는 master / project_admin / safety_manager 만. 그 외는 버튼 비활성.
3. Scope — `project_id` 필터 + RLS. 시공사는 본인 회사 데이터만 조회.
4. Empty/Loading — 미해결 0건시 "✅ 미해결 없음", 로딩시 Skeleton 4행.
5. Edge inputs — 위치 미상/사진 미첨부 허용. 보고자명 익명 가능.
6. State sync — 처리 후 즉시 `load()` 재호출, 탭/카운트 자동 갱신.
7. Audit — 모든 처리 행위는 `audit_logs` 에 status/resolution_note 변경분 기록.
8. Rollback — 처리 후 상태 재변경 가능(audit_logs 누적). 데이터 자체는 보존, 삭제 미지원(법적 증빙).

## UX 강화
- 탭: 미해결 / 조치완료 / 반려 / 전체 + 실시간 카운트 배지
- 검색: 보고자/위치/내용 부분일치
- 헤더에 모바일 신고 페이지 바로가기 버튼
- §54-2 불이익 금지 고지 다이얼로그 내 항시 표시
