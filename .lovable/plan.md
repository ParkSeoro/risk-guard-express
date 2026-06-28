# 네이티브 모바일 앱 빌드 및 배포 방법

현재 프로젝트는 이미 Capacitor가 설정되어 있고, `capacitor.config.ts`에 핫리로드 URL과 백그라운드 위치추적/OTA 업데이트 플러그인이 구성되어 있습니다. 아래 절차대로 진행하시면 실제 디바이스 → 내부 테스트 → 스토어 출시까지 완료할 수 있습니다.

---

## 1단계: GitHub로 코드 내보내기 (필수)

Lovable 샌드박스에서는 네이티브 빌드를 할 수 없습니다. 반드시 본인 PC에서 빌드해야 합니다.

1. Lovable 우측 상단 **GitHub → Export to GitHub** 클릭
2. 본인 PC에서 `git clone <레포 주소>` 후 폴더 진입
3. `npm install` 로 패키지 설치

---

## 2단계: 개발 환경 준비

| 대상 | 필요한 도구 | OS 제한 |
|---|---|---|
| **iOS (iPhone/iPad)** | Xcode 15+, Apple Developer 계정($99/년), CocoaPods | **Mac 필수** |
| **Android** | Android Studio, JDK 17, Google Play Console 계정($25 1회) | Windows/Mac/Linux 모두 가능 |

---

## 3단계: 네이티브 플랫폼 추가 및 빌드

```bash
# 한 번만 실행
npx cap add ios       # iOS 추가 (Mac에서만)
npx cap add android   # Android 추가

# 코드 수정할 때마다 실행
npm run build         # 웹 번들 생성
npx cap sync          # 네이티브 프로젝트에 반영

# 실제 디바이스/에뮬레이터 실행
npx cap run ios
npx cap run android
```

이 단계에서 핫리로드 모드(`server.url`이 Lovable 프리뷰 URL로 설정됨)로 동작하므로, Lovable에서 코드만 바꿔도 폰에 즉시 반영됩니다.

---

## 4단계: 권한 설정 (백그라운드 위치추적용)

### iOS — `ios/App/App/Info.plist` 추가
```xml
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>근무 중 위치 안전 관리를 위해 백그라운드 위치가 필요합니다</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>출퇴근 QR 체크인 시 위치를 확인합니다</string>
<key>UIBackgroundModes</key>
<array><string>location</string><string>fetch</string></array>
```

### Android — `android/app/src/main/AndroidManifest.xml` 추가
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>
```

---

## 5단계: 출시용 빌드 (스토어 제출 전)

출시 빌드 직전, `capacitor.config.ts`에서 `server.url`을 **반드시 제거**하세요. 그러지 않으면 스토어 심사에서 리젝됩니다.

### Android — AAB 생성
```bash
cd android
./gradlew bundleRelease
# 결과물: android/app/build/outputs/bundle/release/app-release.aab
```
서명 키(`.jks`)는 Android Studio → Build → Generate Signed Bundle에서 1회 생성 후 안전하게 보관.

### iOS — Xcode에서 Archive
1. `npx cap open ios`
2. Xcode → Product → Archive
3. Distribute App → App Store Connect → Upload

---

## 6단계: 스토어 등록

### Google Play
1. [Play Console](https://play.google.com/console) → 앱 만들기
2. **내부 테스트 트랙**에 AAB 업로드 → 테스터 이메일 등록 (가장 빠른 검증)
3. 데이터 보안, 개인정보처리방침 URL, 스크린샷(폰 2~8장) 입력
4. 프로덕션 출시 신청 (보통 1~3일 심사)

### Apple App Store
1. [App Store Connect](https://appstoreconnect.apple.com) → 새 앱 생성 (Bundle ID: `app.lovable.943c0fa50f48402483eac68afc236634`)
2. **TestFlight**으로 내부 테스트 (즉시 가능)
3. 스크린샷(6.7" iPhone 필수), 개인정보처리방침 URL 입력
4. 심사 제출 (보통 24~48시간)

---

## 7단계: 출시 후 — OTA 업데이트 운영 (Xcode/Android Studio 재빌드 불필요)

JS/CSS 수정 사항은 매번 스토어 심사 받지 않고 즉시 배포할 수 있습니다.

1. 로컬에서 `npm run build` → `dist/` 폴더를 zip 압축
2. 시스템 로그인 → **마스터 계정** → `/settings/mobile-releases`
3. zip 업로드, 버전(예: `1.0.1`) 입력, 출시 채널 선택
4. 사용자 폰이 다음 실행 시 자동으로 새 번들 다운로드 → 적용

⚠️ 단, 네이티브 코드/플러그인을 추가/수정한 경우에는 OTA로 배포 불가. 반드시 스토어 재빌드/심사 필요.

---

## 예상 일정

| 단계 | 소요 시간 |
|---|---|
| GitHub export + 로컬 셋업 | 30분 ~ 2시간 |
| 디바이스 첫 실행 (Android) | 1~2시간 |
| 디바이스 첫 실행 (iOS, Mac 필요) | 2~4시간 (인증서 발급 포함) |
| Play Store 내부 테스트 | 당일 |
| App Store TestFlight | 당일 |
| Play Store 프로덕션 심사 | 1~3일 |
| App Store 프로덕션 심사 | 1~3일 |

---

## 다음 액션 — 무엇을 도와드릴까요?

플랜 모드에서는 코드를 수정할 수 없습니다. 승인해 주시면 아래 중 필요한 것을 빌드 모드에서 진행합니다:

- ✅ `capacitor.config.ts`에 **출시용/개발용 모드 전환 스크립트** 추가
- ✅ `Info.plist` / `AndroidManifest.xml` 권한 자동 주입 스크립트
- ✅ OTA 번들 zip 자동 생성 npm 스크립트 (`npm run ota:build`)
- ✅ 스토어 등록용 **개인정보처리방침 페이지**(`/privacy`) 생성
- ✅ 상세 운영 매뉴얼을 `docs/mobile-deploy.md`로 저장

원하시는 항목을 알려주시면 한 번에 처리하겠습니다.
