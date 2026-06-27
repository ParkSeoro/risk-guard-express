
# 계획

## 1. 근로자 등록 시 받아야 할 법정교육 자동 표시

### 데이터 흐름 (이미 존재)
- `worker_legal_education_mapping` : 직종(job_type) × 고용형태(employment_type) × 요건유형(req_type) → 과정명/주기/근거법조문
- `workers.required_items` / `worker_required_items` : 개별 근로자에게 부여된 항목
- `worker_education_records` : 실제 이수 기록

### 구현 (UI/표시만)
- **신규 RPC `compute_worker_required_education(worker_id)`**: 매핑 테이블을 조회해 해당 근로자에게 필요한 교육 목록(과정명, 시간, 주기, 다음예정일, 근거조문)을 반환.
- **WorkerRegister.tsx**: 직종/고용형태 선택 즉시 우측에 "이 근로자에게 필요한 법정교육" 카드 미리보기. 등록 완료 시 매핑된 항목을 `worker_required_items`에 자동 시드.
- **WorkerDetail.tsx — 법정교육 탭**: 현재 "교육 이수 내역"만 표시 → "필요 교육 vs 이수 현황" 매트릭스(미이수/만료임박/완료, 근거조문 표기).
- **WorkerManagement.tsx 리스트**: 행마다 "교육 완료율" 배지(예: 3/5). 미이수 클릭 시 상세로.
- **WorkerEducation.tsx**: 상단에 "프로젝트 전체 미이수 현황"(직종별 집계) 추가.
- **리포트 반영**:
  - TBM 일지: 참여자별 미이수 교육 경고 라벨
  - 작업허가서 작성 시 작업자 선택 화면에 "법정교육 미이수" 배지
  - 계약사 점수카드(ContractorScorecard): 교육 이수율 항목 추가

### 자동 갱신
- workers INSERT/UPDATE(job_type, employment_type, hired_at) 트리거 → `worker_required_items` 자동 동기화

---

## 2. 모바일 네이티브 앱화 (백그라운드 위치 + 자동 업데이트)

현재 상태: `@capacitor/core`, `@capacitor/geolocation` 설치, `capacitor.config.ts`는 라이브 프리뷰 URL을 가리킴(개발용). 실제 스토어 배포/백그라운드 미지원.

### 2-1. 네이티브 백그라운드 위치 추적
- `@capacitor-community/background-geolocation` 추가
- `src/lib/tracking/locationTracker.ts`를 분기:
  - 네이티브: BackgroundGeolocation watcher (앱 종료/잠금 화면에서도 동작, iOS Always-Allow, Android Foreground Service)
  - 웹/PWA: 기존 navigator.geolocation 유지
- iOS `Info.plist`: `NSLocationAlwaysAndWhenInUseUsageDescription`, `UIBackgroundModes: location`
- Android `AndroidManifest.xml`: `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, 알림 채널
- 배터리 최적화 안내 다이얼로그 (Android), iOS 권한 단계 안내

### 2-2. OTA 자동 업데이트 (네이티브 쉘 유지, JS 번들만 갱신)
- `@capgo/capacitor-updater` (오픈소스, Capgo CDN 또는 자체 S3/Supabase Storage 호스팅 가능) 채택
- 빌드 파이프라인:
  - `npm run build` → `dist/` zip → Supabase Storage `app-updates/` 업로드
  - 메타 테이블 `app_releases(version, channel, url, mandatory, min_native_version, released_at)`
- 앱 부팅 시 `CapacitorUpdater.notifyAppReady()` → 백그라운드에서 최신 버전 체크 → 다운로드 후 다음 실행 시 적용 (mandatory면 즉시 reload)
- 마스터 화면에 "릴리스 채널" 관리(stable/beta), 강제 업데이트 토글
- 네이티브 코드 변경 시(권한, 플러그인 추가)는 스토어 재제출 필요 — 메타에 `min_native_version`으로 차단

### 2-3. capacitor.config.ts 정리
- 프로덕션 빌드에서는 `server.url` 제거(자체 번들 사용), 개발 빌드 변수로만 사용
- `appName`을 `safenex` 등 실제 명칭으로 정정
- 푸시: `@capacitor/push-notifications` 추가 → 기존 `push_subscriptions`/`send-push` 함수와 연결(FCM/APNs 토큰)

### 2-4. 배포 가이드 문서
- `/docs/mobile-build.md`: GitHub 내보내기 → `npx cap add ios/android` → 서명/스토어 업로드 순서, OTA 채널 운영, 권한 심사 답변 템플릿

---

## 기술 메모

- DB: `worker_legal_education_mapping`은 이미 시드 완료(약 42개). RPC와 트리거만 신규.
- 모바일: 네이티브 빌드/스토어 제출은 사용자 로컬에서 수행해야 함(샌드박스에서 불가). Lovable에서는 코드/설정/OTA 인프라까지 완비.
- 보안: OTA 번들은 서명 검증(공개키 내장) + HTTPS Storage URL.

## 확인 부탁

A. 위 두 가지 모두 한 번에 진행할까요, 아니면 1번(교육 매핑 UI)부터 먼저 끝낼까요?
B. OTA 호스팅은 **Lovable Cloud Storage(자체 호스팅)** 로 가도 될까요? (Capgo 유료 서비스 대신)
C. 모바일 푸시는 FCM(Android) + APNs(iOS) 키를 사용자가 준비해야 합니다. 지금 준비 가능한지요?
