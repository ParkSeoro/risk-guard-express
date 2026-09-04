# #24 TBM (Tool Box Meeting)

## 범위
- `tbm_sessions` (세션·QR·브리핑), `tbm_participations` (근로자 참여 서명).

## 품질 8차원 적용
1. **데이터 정합성** – `is_deleted` 소프트삭제 + 사유 (`useSoftDelete`), 회사 SSOT (`company_id` + `company_name` 동기 저장).
2. **권한 가드** – 페이지 진입은 `useProjectAccess`; RLS는 회사·프로젝트 스코프.
3. **로딩 상태** – Skeleton 카드 행 3개.
4. **빈 상태 / 검색 결과 없음** – 등록 0건(첫 TBM 생성 CTA) vs 필터 0건 분리 메시지.
5. **검색·필터** – 제목·장소·주관자·공종·회사명 통합 검색 + 상태(전체/진행중/종료) + 회사 필터.
6. **요약 KPI** – 전체/진행중/오늘/총 참여자.
7. **실시간** – `tbm_sessions`(프로젝트 필터) + `tbm_participations` Realtime 구독.
8. **출력/감사** – QR 인쇄, A4 일지 인쇄(참여자 서명 포함), 모든 변경은 audit_logs.

## 운영 메모
- QR 베이스 URL은 미리보기 도메인 자동 차단, 게시 도메인(safenex.org) 사용 권장.
- 위험성평가 자동 연동: 위험요인/등급/안전대책 행 자동 채움.
- "이전 TBM 불러오기"로 동일 공종 작업내용/위험요인 복사 가능 (근로자/서명/날짜는 미복사).
- 출근 서명이 당일 연결 TBM 서명. QR은 선택. 세션 실시 사진 최대 3장.
