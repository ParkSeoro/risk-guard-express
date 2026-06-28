# SafeNex 네이티브 앱 빌드·배포 매뉴얼

이 문서는 Lovable 에서 개발 중인 SafeNex 를 iOS App Store / Google Play 에 출시하고,
출시 후 OTA(Over-the-Air) 로 갱신하는 전체 운영 절차입니다.

---

## 0. 사전 준비물

| 대상 | 도구 / 계정 |
| --- | --- |
| 공통 | Node.js 20+, Git, GitHub 계정 |
| iOS | macOS + Xcode 15+, Apple Developer 계정($99/년), CocoaPods |
| Android | Android Studio + JDK 17, Google Play Console($25 1회) |

---

## 1. GitHub Export → 로컬 셋업

```bash
# Lovable 우측 상단 GitHub → Export to GitHub 클릭 후
git clone <레포 주소> safenex
cd safenex
npm install
```

> 이후 Lovable 에서 변경한 내용은 자동으로 GitHub 에 push 되므로,
> 로컬에서는 `git pull` 만 하면 됩니다.

---

## 2. 네이티브 플랫폼 추가 (최초 1회)

```bash
# 두 플랫폼 다 추가하려면 (iOS 는 Mac 필수)
npx cap add ios
npx cap add android

# 권한 자동 주입 (Info.plist / AndroidManifest.xml)
node scripts/prepare-native.mjs
```

---

## 3. 개발 중 — 핫리로드로 디바이스 테스트

```bash
# Lovable 프리뷰 URL 을 가리키도록 빌드
CAP_DEV_URL="https://943c0fa5-0f48-4024-83ea-c68afc236634.lovableproject.com?forceHideBadge=true" \
  npx cap sync

npx cap run ios       # 또는
npx cap run android
```

Lovable 에서 코드만 바꿔도 폰 화면이 즉시 반영됩니다.

---

## 4. 출시용(스토어 제출) 빌드

> ⚠️ **반드시 `CAP_DEV_URL` 을 비운 상태**로 빌드해야 합니다.
> 그렇지 않으면 Apple 심사에서 "원격 URL 로딩"으로 리젝됩니다.

```bash
unset CAP_DEV_URL
npm run build
npx cap sync
```

### 4-1. Android — AAB 생성

```bash
cd android
./gradlew bundleRelease
# 결과: android/app/build/outputs/bundle/release/app-release.aab
```

서명 키(`.jks`)는 Android Studio → **Build → Generate Signed Bundle** 에서 1회 생성 후
**Play App Signing** 에 업로드하면 Google 이 키를 안전 보관합니다.

### 4-2. iOS — Archive 후 업로드

```bash
npx cap open ios
```

Xcode → **Product → Archive** → Organizer → **Distribute App → App Store Connect** → Upload.

---

## 5. 스토어 등록

### Google Play Console
1. **앱 만들기** → 패키지명 `app.lovable.943c0fa50f48402483eac68afc236634`
2. **내부 테스트 트랙**에 AAB 업로드 → 테스터 이메일 추가 (가장 빠른 검증)
3. **데이터 보안** 섹션에 수집 항목/목적 입력 (백그라운드 위치, 카메라, 푸시 토큰)
4. **개인정보처리방침 URL**: `https://safenex.org/privacy`
5. 스크린샷 폰 2~8장, 아이콘 512×512, 피처 그래픽 1024×500
6. 프로덕션 출시 → 심사 1~3일

### App Store Connect
1. **새 앱** 생성, Bundle ID 동일
2. **TestFlight** 으로 내부 테스트 (즉시)
3. **App Privacy** 에 동일 항목 신고
4. 개인정보처리방침 URL 동일
5. 6.7" iPhone 스크린샷 필수
6. 심사 제출 → 보통 24~48시간

---

## 6. 출시 후 — OTA 업데이트 (네이티브 재빌드 불필요)

### 운영 흐름

```bash
git pull                           # Lovable 의 최신 변경 받기
npm run build                      # dist/ 생성
node scripts/ota-bundle.mjs 1.0.1  # releases/safenex-1.0.1.zip
```

1. 시스템에 **마스터 계정** 으로 로그인
2. `/settings/mobile-releases` 진입
3. zip 업로드 + 버전 `1.0.1` 입력 + 채널(stable/beta) 선택
4. 사용자 폰이 다음 실행 시 자동 다운로드 → 적용 → 5초 안에 `appReady` 안 호출되면 자동 롤백

### OTA 로 배포 가능한 변경
- ✅ React/TS/CSS, 텍스트, 라우트, Supabase 호출 로직, UI

### OTA 로 배포 **불가능** — 스토어 재빌드 필요
- ❌ Capacitor 플러그인 추가/삭제, 권한 변경
- ❌ 네이티브 코드 수정, Capacitor 메이저 업그레이드
- ❌ 앱 아이콘/스플래시 변경

---

## 7. 트러블슈팅

---

## 8. GitHub Actions 자동 빌드 (선택)

`.github/workflows/mobile-release.yml` 가 추가되어 있어, 아래 트리거 중 하나로 OTA zip 이 자동 생성됩니다.

| 트리거 | 결과물 위치 |
| --- | --- |
| `main` 브랜치 push | Actions → 해당 run → Artifacts (`safenex-ota-<버전>`) |
| Actions 탭 → Run workflow (버전 직접 입력) | 동일 |
| `git tag v1.0.1 && git push --tags` | GitHub **Releases** 에 zip + SHA256SUMS.txt 자동 첨부 |

운영 흐름 예:
```bash
git tag v1.0.1
git push origin v1.0.1
# → Actions 완료 후 Releases 페이지에서 safenex-1.0.1.zip 다운로드
# → /settings/mobile-releases 에 업로드
```

> 네이티브 폴더(`ios/`, `android/`)가 레포에 커밋되어 있으면 `npx cap sync` 까지 자동 실행됩니다.
> AAB/IPA 빌드는 코드 서명 키 보안 때문에 자동화에 포함하지 않았습니다 (로컬 Mac/Studio 에서 수행).

| 증상 | 원인 / 조치 |
| --- | --- |
| Apple 심사 "Guideline 4.2 — minimum functionality" | `server.url` 이 남아있음. `unset CAP_DEV_URL` 후 재빌드 |
| Android 백그라운드 위치 안 됨 | OS 설정에서 "항상 허용" 필요 + Foreground Service 알림 표시 확인 |
| OTA 적용 후 흰 화면 | `appReadyTimeout: 5000` 으로 자동 롤백됨. 새 번들 재배포 |
| 푸시 안 옴 | FCM(Android) `google-services.json`, APNs(iOS) 인증서 등록 확인 |

---

## 8. 비상 연락 / 책임자

- 시스템 운영: 마스터 계정 보유자
- 개인정보 보호책임자: privacy@safenex.org
- 사고 보고 워크플로우: `/incidents` (중대재해 24시간 카운트다운)
