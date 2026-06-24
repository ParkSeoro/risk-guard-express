## 목표
QR 일일이 찍지 않아도 근로자 위치가 자동으로 추적되도록 한다. **GPS 지오펜싱(실외) + Wi-Fi AP 핑거프린팅(실내)** 하이브리드를 Capacitor 네이티브 앱으로 구현하고, 결과는 기존 `worker_zone_events` 테이블에 그대로 쌓아 분포 대시보드에 자동 반영한다.

## 전체 그림

```text
[근로자 폰 - Capacitor 앱]
   ├─ 백그라운드 GPS (실외) ──┐
   ├─ Wi-Fi 스캔 (실내)     ─┤──► /track 엣지함수 ──► worker_zone_events
   └─ 가속도/배터리 최적화   ─┘                           │
                                                          ▼
                                              실시간 분포 대시보드
                                              (이미 구축 완료)
```

## Phase A — 데이터 모델 & 사이트맵 보강 (DB)

기존 `site_zones`(폴리곤 0~1 정규화)에 **실좌표·Wi-Fi 지문**을 더한다.

- `site_maps`에 컬럼 추가
  - `geo_anchor_nw` (lat, lng) / `geo_anchor_se` (lat, lng): 맵 이미지의 모서리 실좌표 → 폴리곤을 위경도로 변환 가능
- `site_zones`에 컬럼 추가
  - `geo_polygon` (jsonb): NW/SE 앵커로부터 계산된 위경도 폴리곤 (지오펜스 판정용)
  - `wifi_fingerprint` (jsonb): `[{bssid, avg_rssi, stddev}]` 형태, 구역별 Wi-Fi 지문
- `worker_zone_events`에 컬럼 추가
  - `source` enum: `qr` | `gps` | `wifi` | `manual` (기존 QR 호환 유지)
  - `accuracy_m` numeric, `lat`/`lng` numeric (감사·후속 분석용)
- 신규 테이블 `wifi_fingerprint_samples` (캘리브레이션 원본)
  - `zone_id`, `sample_at`, `bssid`, `rssi`, `collected_by_user_id`
  - RLS: 같은 프로젝트 관리자만 read/write
- 모든 신규 테이블에 GRANT (authenticated/service_role) + RLS + 정책

## Phase B — 사이트맵 캘리브레이션 UI (관리자)

`/site-maps` 페이지 확장:
1. 맵 이미지 업로드 후, 지도 모서리 두 점(NW/SE)의 위경도를 입력하거나 Leaflet 미니맵에서 클릭으로 지정
2. 폴리곤 그리기는 그대로 → 저장 시 `geo_polygon` 자동 계산
3. **구역별 "Wi-Fi 지문 수집" 버튼**: 캘리브레이션 모드로 들어가 폰을 해당 구역에 두고 30초간 주변 AP RSSI 샘플링 → `wifi_fingerprint_samples`에 저장 → 구역별 평균/표준편차를 `site_zones.wifi_fingerprint`에 집계

## Phase C — Capacitor 네이티브 앱 전환

설치/설정:
- `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`
- `@capacitor/geolocation` (포그라운드 GPS)
- `@capacitor-community/background-geolocation` (백그라운드 GPS + 지오펜스)
- `@capacitor-community/wifi` 또는 `cordova-plugin-wifiwizard2` 대체 (Wi-Fi BSSID/RSSI 스캔; iOS는 NEHotspotHelper 권한 제한 있음 → iOS는 GPS 비중을 더 크게)
- `appId: app.lovable.943c0fa50f48402483eac68afc236634`, `appName: safenex-worker`
- hot-reload용 `server.url`은 프리뷰 URL로 설정

권한 UX:
- 첫 실행 시 "항상 허용" 위치 권한, 알림 권한 안내 (iOS 백그라운드 필수)
- 배터리 최적화 예외 안내 화면(Android)

## Phase D — 추적 클라이언트 로직

`src/lib/tracking/locationTracker.ts` (신규):
- **포그라운드**: 10초 주기 GPS + 30초 주기 Wi-Fi 스캔
- **백그라운드**: `BackgroundGeolocation`으로 지오펜스 등록(프로젝트의 모든 `site_zones.geo_polygon`) → enter/exit 콜백에서 이벤트 전송
- **융합 판정**:
  - GPS 정확도 ≤ 15m이면 GPS 우선
  - 그 외엔 Wi-Fi 지문과 코사인 유사도 비교 → 최상위 구역 채택
  - 두 결과가 다르면 더 정확도 높은 쪽 채택, `accuracy_m` 기록
- **디바운스**: 동일 구역 연속 이벤트는 5분 합치기, 다른 구역으로 전환된 경우만 entry/exit pair 생성

`src/lib/tracking/wifiFingerprint.ts`:
- 코사인 유사도 함수, RSSI 정규화

## Phase E — 엣지 함수 `track-location`

`supabase/functions/track-location/index.ts`:
- 입력: `{ worker_id, lat, lng, accuracy, wifi_scan: [{bssid, rssi}], device_ts }`
- Zod 검증
- 서버측에서도 지오펜스 재계산(클라이언트 변조 방지) + Wi-Fi 매칭 재실행
- `worker_zone_events`에 `source`, `accuracy_m`, `lat`, `lng`와 함께 insert
- 위험구역이면 기존 로직대로 `unauthorized_entry`
- CORS + JWT 검증

## Phase F — 대시보드/UX 보강

기존 `WorkerDistribution.tsx`:
- 마커 모양으로 소스 구분 (GPS=●, Wi-Fi=◆, QR=▲, Manual=○)
- 마커에 정확도 반경 원(`accuracy_m`) 표시
- "위치 정확도 낮음" 카드: 평균 accuracy_m이 30m 초과인 구역 경고

`/admin/tracking-health` (신규 소형 페이지):
- 최근 24h 소스별 비율, 평균 accuracy, 실패율
- Wi-Fi 지문 수집 누락 구역 리스트 → 캘리브레이션 유도

## Phase G — 프라이버시 & 정책

- 근로자 첫 로그인 시 위치추적 동의 화면 (목적·보관기간·옵트아웃)
- 근로자 본인 화면에서 "오늘의 내 추적 로그 보기" + "삭제 요청" 버튼
- `worker_zone_events.lat/lng`는 90일 후 자동 NULL 처리(스케줄러 또는 cron)

## 기술 노트
- iOS Wi-Fi 스캔은 시스템 제약(MFi/NEHotspotHelper 승인 필요)이 있어 사실상 GPS+지오펜스 위주가 됨. 실내 정확도가 핵심인 현장은 Android 단말 우선 배포 권장.
- 백그라운드 GPS는 배터리 영향이 있으므로 거리 필터(이동 10m 이상)와 정지 감지(Stationary Mode) 활성화.
- 지오펜스는 OS당 등록 한도(iOS 20개)가 있어 구역이 많을 땐 "현재 위치 반경 1km 내 구역만 동적 등록" 전략 적용.
- 모든 신규 DB 작업은 마이그레이션 1건으로 묶고 GRANT 포함.

## 산출물 요약
- DB 마이그레이션 1건(컬럼 추가 + 신규 테이블 + RLS/GRANT)
- 엣지함수 `track-location`
- 신규 모듈: `src/lib/tracking/*`
- 수정 페이지: `SiteMaps.tsx`(캘리브레이션), `WorkerDistribution.tsx`(소스 표시)
- 신규 페이지: `/admin/tracking-health`, 근로자 동의/내로그 화면
- Capacitor 설정 및 플러그인 도입

승인하시면 Phase A(DB)부터 순서대로 진행합니다.