# Feature Card #26 — 사고 & 비상대피훈련

## Pages
- `src/pages/Incidents.tsx` — 사고 보고 (산안법 §57, 중대재해 24h)
- `src/pages/EmergencyDrills.tsx` — 비상대피훈련 (산안법 §52, 연 1회)

## 8-Dim Polish

1. **KPI Cards** — Incidents: 전체/중대/시한초과 · Drills: 전체/최근1년/예정/법정이행
2. **Search & Filter** — Drills 검색(훈련명·장소·진행자) + 탭(전체/예정/완료/차기초과); Incidents는 기존 검색/탭 유지
3. **Skeleton Loading** — 표 로딩 시 4행 스켈레톤
4. **Empty States** — 미등록 vs 필터결과 없음 분리
5. **Realtime** — `incident_reports`, `emergency_drills` 프로젝트 스코프 실시간 구독
6. **Deadline Badges** — 중대재해 24h D-Day(시간단위), 차기 훈련 D-Day(일단위) 톤 분리(ok/warn/danger)
7. **Soft Delete** — `useSoftDelete()` (Drills) / RLS (Incidents)
8. **Legal Anchor** — 카드 상단에 §52/§57 명시, 등록 폼에 보고시한 경고문 표시
