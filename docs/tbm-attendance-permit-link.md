# TBM · 출퇴근 · 허가서 연동

러버블 시절 기능이 각각 동작하지만, 데이터 축이 달랐습니다. 현재 SSOT와 연결 지점:

| 축 | 테이블 | 역할 |
|----|--------|------|
| 출퇴근 | `worker_entry_logs` | 출근/퇴근 시각 |
| TBM | `tbm_sessions` + `tbm_participations` | 당일 브리핑·서명 |
| 허가서 인원 | `work_permit_workers` + `personnel_count` | 작업 크루·양식 인원 |

## 이번에 연결된 것

1. **근로자 배정 → 작업인원 자동 반영** (`WorkPermitWorkersDialog`)
2. **인쇄 뒷장(을지)** — 배정 명단 + 연결 TBM 서명 (`PermitWorkersPrintPage`)
3. **출근자 빠른 선택** — 오늘 `entry_at` 있고 `exit_at` 없는 근로자
4. **죽은 `/tbm` 링크** → `/app/admin/tbm-logs`

## 자연스러운 하루 흐름 (권장)

```
출근(QR/GPS) → 당일 TBM 서명 → 허가서에 근로자 배정(출근자 버튼) → 결재·인쇄(뒷장 명단)
```

## 후속(아직 미완)

- 허가서에 연결된 TBM 참여자 → `work_permit_workers` 자동 동기화
- GPS 체크인 시 당일 배정 허가서 `work_permit_id` 기록
- 모바일 근로자 “TBM 참여”를 생성 화면이 아니라 `/tbm/:token` / Today 모달로
- `v_safety_work_bundle`을 허가서 상세 헤더에 표시
