# 현장 GPS·맵 정렬 (제품 경로)

## 기본 경로 (권장)
1. **PC** 「통합 현장 관제맵」→ **[1] 도면 업로드** — 드론/도면 이미지만 등록  
2. **모바일** 마스터 → 더보기 → **맵·GPS 맞추기** → **워킹 보정** (A·B·C)  
3. (선택) 잔여 오차는 **1점 보정**

위성에 사진을 입히는 과정은 **필수가 아닙니다.**

## 선택 · 고급
| 기능 | 언제 |
|------|------|
| PC 위성 TL/TR/BL 수동 정렬 | 현장 가기 전 대략 배치, 사무실 검증, 워킹 대신 PC로 맞출 때 |
| 1점 바이어스 | 지오레프 이후 남는 수~수십 m |

## UX 원칙
- PC 카피/토스트: 업로드 후 **모바일 워킹**을 다음 단계로 안내
- 위성 TL/TR/BL 도구는 **「고급」아코디언**에 접어둠
- 구역 그리기 게이트 문구: 워킹(권장) / 위성(고급) 둘 다 안내

## 핵심 파일
- `src/pages/SiteControlMap.tsx` — 업로드 + 고급 위성
- `src/pages/MobileMapCalibration.tsx` — 워킹 / 1점
- `src/lib/tracking/recommendControlPoints.ts`
- `src/lib/tracking/fitAffineFromControlPoints.ts`
