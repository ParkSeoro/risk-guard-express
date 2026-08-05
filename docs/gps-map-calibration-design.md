# 마스터 현장 GPS·맵 정렬 (설계)

목표: 마스터가 현장에서 **갈 수 있는 위치**를 따라가며 GPS를 찍으면,
시스템이 맵 지오레프(및 잔여 1점 바이어스)를 맞춘다.  
모서리(산·하천) 강제 금지 — **추천 지점 + 못 감 교체**.

## 상태

| 기능 | 위치 | 상태 |
|------|------|------|
| 부팅 OTA 게이트 (로그인 전) | `bootOtaGate` + `main.tsx` | 구현 |
| 워킹 보정 (추천 N점 → affine) | `MobileMapCalibration` 워킹 탭 | 구현 |
| 1점 잔여 바이어스 | 같은 화면 1점 탭 | 구현 (Phase A) |
| PC TL/TR/BL 맵핑 | `SiteControlMap` | 기존 |

## 워킹 보정 UX
1. 더보기 → **맵·GPS 맞추기** → 워킹 보정
2. 시스템이 UV 후보를 점수화해 A/B/C 추천  
   - 위험/작업 구역(UV 투영) · 최근 `worker_last_positions` · 맵 분산  
   - 가장자리(모서리) inset 제외
3. 추천 지점 도착 → **여기 좌표 잡기** (정확도 게이트)
4. **여기 못 감** → 제외 반경 두고 다음 후보
5. 핀 탭으로 미세 조정 가능
6. 3점 이상 → 최소제곱 affine → `site_maps.geo_transform` 저장
7. 잔여 수 m는 **1점 보정** (`projects.gps_calibration`)

## OTA
- 네이티브 콜드스타트: 로그인 UI 전에 스플래시에서 확인·다운로드·즉시 적용
- `app-updates` Storage SELECT: anon + authenticated (프리로그인 다운로드)
- 더보기 OTA 카드: 수동 재시도 전용

## 핵심 파일
- `src/lib/native/bootOtaGate.ts`, `src/main.tsx`
- `src/lib/tracking/recommendControlPoints.ts`
- `src/lib/tracking/fitAffineFromControlPoints.ts`
- `src/pages/MobileMapCalibration.tsx`
- `supabase/migrations/20260805060000_ota_anon_read_app_updates.sql`
