# 마스터 현장 GPS·맵 정렬 (설계)

목표: 마스터가 현장에서 **현재 GPS**와 **등록된 사이트맵 위 지점**을 맞추면,
시스템이 오프셋을 계산해 지오펜스/분포 GPS 정확도를 높인다.

## 현재 상태
| 기능 | 위치 | 한계 |
|------|------|------|
| TL/TR/BL 모서리 GPS 찍기 | PC 현장통제맵 맵핑 탭 | 데스크톱; 도면 자체를 Earth에 맞춤 |
| Walk & Drop | 모바일 구역 드롭 | 맵 정렬 아님, 구역만 생성 |
| GPS 바이어스 보정 | **없음** | 폰 raw GPS 그대로 사용 |

## 추천: 1점 보정 (Phase A) — 먼저 만들기
**가정:** 드론 오버레이 georef(TL/TR/BL)는 이미 PC에서 맞춰 둠.  
현장에선 **잔여 오차(수~수십 m)** 만 보정.

### UX (마스터 전용 모바일)
1. 더보기/홈 → **맵·GPS 맞추기**
2. 활성 사이트맵 도면 표시
3. 지금 서 있는 지점을 도면에서 **탭**
4. 「현재 GPS로 맞추기」 → 고정밀 위치 수신 (정확도 > 30~40m면 저장 거부)
5. `Δlat/Δlng = 맵WGS84 − 폰GPS` 저장 (`projects.gps_calibration` 또는 `site_maps`)
6. 이후 `track-location` / 클라이언트 추적에 `gps + Δ` 적용
7. 「보정 초기화」 버튼

### 왜 1점이 먼저인가
- 질문(“현재 위치와 맵 위치를 특정 → 자동 계산”)에 정확히 대응
- TL/TR/BL 재촬영보다 현장 부담 적음
- **OTA만으로 가능** (새 네이티브 플러그인 불필요)

### 위험
- GPS 멀티패스 오차가 Δ에 구워지면 **전 근로자** 지오펜스가 밀림 → 정확도 게이트 필수
- 도면 georef가 크게 틀리면 1점으로 부족 → Phase B

## Phase B: 모바일 3모서리 찍기
PC SiteControlMap의 TL/TR/BL 찍기를 폰으로 이식.  
도면 자체가 틀렸을 때. 구역 WGS84는 재그리기/재변환 필요할 수 있음.

## Phase C: N점 최소제곱 (나중)
4~6점 탭+GPS로 affine 추정. 정확도는 좋지만 UX 무거움.

## 구현 시 건드릴 파일 (A)
- `src/pages/MobileMapCalibration.tsx` (신규)
- `src/lib/tracking/gpsCalibration.ts` + 테스트
- `src/lib/tracking/imageSpaceGeo.ts` (uv→WGS84 재사용)
- `locationTracker.ts` + `track-location` Edge (오프셋 적용)
- migration: `gps_calibration jsonb`
- `MobileHome` 마스터 CTA

**AAB 불필요** (기존 Geolocation 사용).
