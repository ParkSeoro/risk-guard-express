# Feature Card — 안전관리자 선임이력 (#16)

법적 근거: 산안법 §15 (안전보건관리책임자), §16 (관리감독자), §17 (안전관리자), §18 (보건관리자), §22 (산업보건의), 시행규칙 §11 (선임 14일 내 노동청 신고).

## Scope
- `/safety-appointments` (SafetyAppointments.tsx) — 선임/해임 이력 + 노동청 신고 트래킹
- 테이블: `safety_appointments` (soft delete)

## 8-Dim Checklist
1. Happy path — 선임 등록 → 노동청 신고일/문서번호/증빙 입력 → 활성 배지 → 해임시 종료일 입력.
2. Permission — 작성/수정/삭제: master, project_admin, safety_manager. 시공사 본인 회사만 RLS로 조회.
3. Scope — `project_id` 필터 + RLS, `is_deleted=false`.
4. Empty/Loading — Skeleton 4행 + 선임 0건 CTA. 활성 안전관리자 부재시 경고 배너(§17).
5. Edge inputs — 검색(성명/문서번호), 직위 필터, 상태 필터(활성/종료/미신고/전체).
6. State sync — 등록/수정 즉시 reload. 14일 신고 기한 D-Day 배지.
7. Audit — 등록/수정/삭제 audit_logs 적재.
8. Rollback — soft delete + 휴지통 복원.

## UX 강화
- 활성 안전관리자 부재 경고(§17)
- 미신고/지연 신고(14일 초과) D-Day 배지 — `D-3` / `D-Day` / `D+5 초과`
- 검색 + 직위/상태 필터
- Skeleton 로딩
- 종료 예정/만료 항목 시각 구분
