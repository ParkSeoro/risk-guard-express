# TBM · 출퇴근 · 허가서 연동 (합의안)

## 확정 정책

| 항목 | 결정 |
|------|------|
| 인원 (초기) | 전날 **예상 배정**이 SSOT → 연결된 TBM 참석자와 맞춤 (`syncPermitCrewToTbm`) |
| 인원 (출퇴근·TBM 참여 정착 후) | **TBM 참석자** 또는 **실출근**이 SSOT → 허가서 명단을 맞춤 |
| 실출근 0명 | **기존 배정을 지우지 않음** (빈 목록으로 replace 금지) |
| 인쇄 | 승인 직후 가능 (이후 명단 변경과 무관) |
| TBM | **1 허가서 = 1 TBM**, 진입점 2개(허가서 상세 / TBM「허가서에서」) |
| AI | 브리핑 **초안만** |
| 서명 | 출근 후 배정 허가서+위험요지 **일괄 확인 후 서명 1번** → TBM 참여에 재사용 |
| 미서명 게이트 | **v1 없음** (서명 없이도 퇴근 가능, 확인은 권장) |
| 당일 인원 수정 권한 | 관리감독자·현장소장·안전관리자·프로젝트관리자·마스터 |

## 하루 흐름

```
[전날] 허가서 작성 → 예상 인원 배정 → 결재 승인 → (선택) 인쇄
      → 당일 TBM 연결 시 배정 명단을 TBM 참석자로 동기화

[당일 · 출퇴근 전] 허가서 ↔ TBM 을 배정 기준으로 맞춤
      「TBM 일지 열기」= 연결 세션으로 이동 + 배정→TBM heal

[당일 · 출퇴근/TBM 참여 후]
  · 「실출근으로 갱신」: 미퇴근 출근자가 있을 때만 허가서 교체 후 TBM 맞춤
  · 「TBM으로 맞추기」: TBM 참석자로 허가서 명단 교체 (참석 0명이면 유지)
```

## DB

- `worker_daily_acks` — 당일 확인·서명
- `work_permit_workers` + `personnel_count` — 예상/실원
- `work_permits.tbm_session_id` — 1:1 TBM (결재 잠금 예외 · RPC `link_work_permit_tbm`)

적용:
- [`supabase-apply-daily-acks.md`](./supabase-apply-daily-acks.md)
- [`supabase-apply-permit-tbm-link.md`](./supabase-apply-permit-tbm-link.md)
- 피드백 결재: [`supabase-apply-feedback-approval.md`](./supabase-apply-feedback-approval.md)

## TBM 일지 작성만 허가서 연동

- **「허가서에서」** / 허가서 상세 CTA → `ensureTbmForPermit` → RPC 링크
- 허가서 연동 TBM의 **주관자(`leader_name`)** = 허가서 작성자 (상신자 → form 작성자 → created_by)
- **「이전 TBM 불러오기」** → TBM 일지 폼 **내용만** 복사 (허가서 링크·근로자·서명·날짜 미복사)
- 허가서 화면에 이전 TBM 불러오기 없음
- 이미 생성된 TBM의 주관자는 소급 변경하지 않음 (신규 생성분만 적용)
