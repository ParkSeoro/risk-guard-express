# Quality Cards #27-29

## #27 결재 라우트 템플릿 (SettingsApprovalRoutes)
- KPI 4종: 내 전용 / 회사 공용 / 프로젝트 공용 / 전체
- 템플릿명 검색 + scope 필터(mine/company/shared/all) 동시 적용
- 카드별 [복사] 버튼: 다른 사용자/공용 템플릿을 "내 전용"으로 복제 (안전 기본값)
- Realtime: `approval_route_templates` (project 범위) 구독으로 다른 관리자 변경 즉시 반영
- 빈 상태 분리: 등록 없음 vs 검색/필터 결과 없음

## #28 AI 설정/크레딧 대시보드 (SettingsAI)
- 모델 목록을 Gemini 중심으로 갱신 (Gemini 3 Flash 기본 권장, 2.5 Flash/Pro, GPT-5/5 mini)
- KPI 5종 (최근 7일): 작업 수 / 성공 / 실패 / 평균 latency(ms) / 오늘
- Realtime: `ai_generation_jobs` 구독 — 다른 사용자 호출도 실시간 반영
- 마스터에게 AI 로그 페이지 바로가기 노출

## #29 건강검진 & 작업환경 측정 후속 정리
- HealthCheckups: `health_checkups` Realtime 구독 (프로젝트 범위)
- EnvMeasurements: `work_env_measurements` + `work_env_factors` Realtime 구독
- 모바일/다른 매니저 입력이 즉시 반영되어 D-Day/유소견 KPI 신뢰도 확보
