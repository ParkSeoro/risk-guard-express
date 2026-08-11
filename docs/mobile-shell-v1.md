# Mobile Shell — 구현 로드맵 현황

AAB는 **프리뷰 역할별 검수 후** 확정 커밋으로 빌드합니다.

## 순서별 상태

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1 | 프로젝트별 역할·권한 기준 | **부분** | 셸 UI/`useMobileAccess`는 선택 프로젝트 `role_new` SSOT. AuthGuard 데스크탑/폰 진입은 여전히 전역 role union (멀티프로젝트 사용자 주의). |
| 2 | 마스터 모바일 프리뷰 (PC) | **완료** | 설정 → 모바일 프리뷰. in-process `PreviewFrameRouter`(중첩 Router/iframe 없음). 역할·프로젝트·기기. 쓰기 차단. |
| 3 | 공통 모바일 셸·하단 메뉴 | **완료** | `MobileShell` + 작업중지 FAB |
| 4 | 근로자/관리자 오늘 | **완료** | `/app/worker/today` |
| 5 | 날씨·건강로그·작업중지 | **완료(1차)** | 날씨 카드, 건강로그 전화매칭, 작업중지 프로필 수정+관리자 목록 |
| 6 | 할 일·자료 뷰어 | **완료** | `/tasks`, `/docs` |
| 7 | 통합 결재함 | **완료(1차)** | `/approvals`만 승인/반려. `/permits`는 **조회 전용**. 딥링크→결재함 |
| 8 | 오프라인·딥링크·권한 테스트 | **부분** | 딥링크/셸 유닛 테스트 추가. 오프라인 큐는 후속. |
| 9 | 프리뷰에서 역할별 검수 | **준비됨** | 사용자·마스터가 PC 프리뷰로 검수 |
| 10 | 확정 커밋으로 새 AAB | **대기** | 검수 후 `build/android-aab` push |

## 출입 정지

모바일·데스크탑 동일 DB. 적용: [`supabase-apply-suspension.md`](./supabase-apply-suspension.md)

## 검수 체크리스트 (프리뷰)

- [ ] 근로자: 오늘(날씨·출근·건강), 할 일, 자료, 알림 — 결재 탭 없음 · 작업중지 FAB 있음
- [ ] 관리자: 오늘 · **현장** · 결재 · 알림 · 더보기 — 작업중지 FAB 없음(오늘 배너/현장으로)
- [ ] 알림·결재 탭: SafeNex 헤더만 (이중 primary 헤더·홈 뒤로가기 없음)
- [ ] 프로젝트 미선택 관리자: 근로자 탭으로 안 떨어지고 선택 카드 표시
- [ ] 프리뷰에서 점검/TBM/맵보정 진입 가능 (today로 튕기지 않음)
- [ ] 허가서 알림 → 결재함 (허가 목록에서 승인 버튼 없음)
- [ ] 프리뷰에서 승인/정지/작업중지 시도 → “변경 불가” 토스트

## 머지 전 보는 방법

1. **이 PR의 Vercel Preview** (배포되면) → 마스터 로그인 → 설정 → **모바일 프리뷰**
2. 프로덕션 `https://risk-guard-express.vercel.app` 은 main 머지 후에만 반영
3. 로컬: `npm run dev` → `/app/admin/settings/mobile-preview` (마스터)

## AAB

검수 통과 후:

```bash
git push origin HEAD:build/android-aab
```

또는 Actions → Android AAB → Run workflow.
