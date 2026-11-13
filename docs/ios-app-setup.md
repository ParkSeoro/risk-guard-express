# Safenex 아이폰 앱

지금 웹 화면을 그대로 아이폰 껍데기로 감쌉니다. 새 화면을 만들지 않습니다. 번들 아이디는 안드로이드와 같은 `org.safenex.app`입니다. 웹 서버와 안드로이드 설치본은 이 작업으로 바뀌지 않습니다.

이 저장소에 Xcode 프로젝트 `ios/`가 있습니다. 컴파일과 서명은 Mac의 Xcode가 합니다. 본인 Mac이 없으면 GitHub의 Mac 빌더가 같은 일을 하고 TestFlight로 올립니다. 절차는 아래 「GitHub에서 올리기」입니다.

## 이미 넣어 둔 것

| 항목 | 값 |
| --- | --- |
| 프로젝트 | `ios/App/App.xcodeproj` |
| 표시 이름 | Safenex |
| 번들 아이디 | `org.safenex.app` |
| 버전 | `1.1.9` (빌드 번호 `479`, 안드로이드 `androidVersionCode`와 같음) |
| 권한 문구 | `ios/App/App/Info.plist` (위치, 카메라, 사진, 백그라운드 위치·알림, 한국어, 수출 규정 아니오) |
| 개인정보 목록 | `ios/App/App/PrivacyInfo.xcprivacy` (추적 없음) |
| 앱 아이콘 | `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (1024×1024) |
| 콘솔에 붙여 넣을 답 | `docs/app-store-connect-fill.md` |
| 로컬 주소 방식 | `capacitor.config.ts`의 `iosScheme: 'https'` |

웹 묶음(`ios/App/App/public`)은 Mac에서 `cap sync`할 때 다시 복사됩니다. 저장소에는 넣지 않습니다.

## 1. Mac과 Xcode

- Mac이 있어야 합니다. 이 클라우드 환경에서는 아이폰 앱을 빌드하거나 업로드할 수 없습니다.
- Xcode: [Mac App Store의 Xcode](https://apps.apple.com/app/xcode/id497799835)
- 설치 후 Xcode를 한 번 열어 추가 구성요소 설치를 끝냅니다.

참고: [Capacitor iOS 문서](https://capacitorjs.com/docs/ios), [작업 순서](https://capacitorjs.com/docs/basics/workflow)

## 2. Apple Developer 개인 가입

사업자등록이 없으므로 **개인(Individual)** 로 가입합니다. 조직 가입은 D-U-N-S 번호가 필요합니다.

1. [등록 페이지](https://developer.apple.com/programs/enroll/)에서 Apple ID로 로그인합니다.
2. Individual을 고르고 연회비 **99달러**를 냅니다.
3. 승인은 보통 하루 안쪽입니다. [계정](https://developer.apple.com/account)에 멤버십이 보여야 다음 단계로 갑니다.

## 3. 앱 아이디

1. [Identifiers](https://developer.apple.com/account/resources/identifiers/list)에서 앱 아이디를 추가합니다.
2. Bundle ID는 **명시적** `org.safenex.app`입니다. 다른 글자면 Xcode 서명과 맞지 않습니다.
3. 기능은 나중에 Xcode에서 켜도 됩니다. 푸시를 쓸 계획이면 Push Notifications를 켜 둡니다.

## 4. App Store Connect에 앱 만들기

콘솔 칸에 붙여 넣을 이름, 설명, 개인정보 답, 심사 메모는 [`docs/app-store-connect-fill.md`](./app-store-connect-fill.md)에 있습니다.

1. [App Store Connect 앱 목록](https://appstoreconnect.apple.com/apps)에서 새 앱을 만듭니다.
2. 플랫폼 iOS, 이름 Safenex, 기본 언어 한국어, 번들 ID `org.safenex.app`, SKU는 `safenex-ios`입니다.
3. 개인정보 처리방침 URL은 [https://safenex.org/privacy](https://safenex.org/privacy)입니다.

## GitHub에서 올리기

본인 Mac이 없을 때의 경로입니다. 워크플로는 [`.github/workflows/ios-ipa.yml`](../.github/workflows/ios-ipa.yml)이고, Actions에서 **직접 실행할 때만** 돌아갑니다. 일반 push마다 Mac 빌더를 쓰지 않습니다.

윈도우 브라우저에서 키를 만들고, GitHub 시크릿에 넣습니다. `.p8` 내용과 인증서는 채팅이나 저장소에 올리지 않습니다.

1. [App Store Connect → 사용자 및 액세스 → 통합](https://appstoreconnect.apple.com/access/integrations/api)에서 API 키를 만듭니다. 이름은 `GitHub Actions`, 역할은 **관리**입니다. 앱 관리만으로는 서명 인증서를 만들지 못합니다.
2. 키를 내려받습니다. 파일은 한 번만 받아집니다. 키 ID와, 페이지 위쪽의 발행자 ID를 적어 둡니다.
3. [멤버십](https://developer.apple.com/account)에서 팀 ID(10자)를 확인합니다.
4. 저장소 Settings → Secrets and variables → Actions에 다음 네 개를 넣습니다.

| Secret | 값 |
| --- | --- |
| `APPLE_API_KEY_P8` | `.p8` 파일 전체. `BEGIN PRIVATE KEY` 줄부터 `END` 줄까지 |
| `APPLE_API_KEY_ID` | 키 ID |
| `APPLE_API_ISSUER_ID` | 발행자 ID |
| `APPLE_TEAM_ID` | 팀 ID |

5. 이 워크플로 파일이 기본 브랜치에 있으면 Actions → **iOS IPA** → Run workflow 입니다. 끝나면 TestFlight에 빌드가 나타나고, 수출 규정은 **아니오**입니다.
6. 아이폰의 TestFlight 앱으로 설치한 뒤 로그인과 출근을 확인합니다. 6.7인치 세로 스크린샷 2장은 그 화면으로 찍습니다.

## 5. Mac에서 빌드

저장소를 받은 폴더에서:

```bash
bun install --frozen-lockfile
unset CAP_DEV_URL
bun run build
bunx cap sync ios
node scripts/prepare-native.mjs
open ios/App/App.xcodeproj
```

`CAP_DEV_URL`이 남아 있으면 폰이 개발 서버 주소를 엽니다. 스토어에 올리는 빌드에서는 비웁니다. [스토어 배포 설명](https://capacitorjs.com/docs/ios/deploying-to-app-store)

Xcode에서:

1. 왼쪽 `App` 대상 → **Signing & Capabilities** → Team에 본인 Apple Developer 팀을 고릅니다. Automatically manage signing을 켭니다.
2. **+ Capability**로 **Push Notifications**를 추가합니다.
3. **Background Modes**에서 Location updates, Background fetch, Remote notifications를 켭니다. `Info.plist`에 같은 항목이 이미 있습니다.
4. 위쪽 기기 목록에서 연결한 아이폰을 고르고 Run(▶)으로 설치합니다. 아이폰은 설정 → 개인정보 보호 및 보안 → 개발자 모드가 필요할 수 있습니다.

## 6. TestFlight

기기에서 한 번 열린 뒤에 올립니다.

1. Xcode 메뉴 **Product → Archive**.
2. Organizer에서 **Distribute App → App Store Connect → Upload**.
3. [TestFlight](https://developer.apple.com/testflight/)에 빌드가 나타나면 내부 테스터(본인)로 설치합니다.
4. 수출 규정 질문은 **아니오**입니다. 앱은 일반 HTTPS만 쓰고, `Info.plist`에 `ITSAppUsesNonExemptEncryption = false`가 있습니다.

## 7. 심사에 적을 내용

붙여 넣을 문장은 [`docs/app-store-connect-fill.md`](./app-store-connect-fill.md) 4절입니다. 카테고리는 비즈니스, 연령은 18세 이상, 광고와 앱 내 구입은 없습니다.

위치는 출근과 현장 위험구역용입니다. 백그라운드 위치는 심사가 엄격합니다. 안내: [위치 권한 심사](https://developer.apple.com/app-store/review/guidelines/#location), [백그라운드 위치](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background)

개인정보 질문: [App Privacy](https://developer.apple.com/app-store/app-privacy-details/). 스크린샷은 아이폰에 설치한 화면으로 6.7인치 세로 2장 이상입니다.

## 8. 푸시와 QR은 첫 설치 뒤에 이어서

첫 TestFlight는 로그인과 출근 확인용입니다. 아래 둘은 껍데기만으로 끝나지 않습니다.

- **푸시.** 안드로이드는 FCM입니다. 아이폰은 Apple 푸시 키(APNs)를 Firebase iOS 앱에 넣어야 같은 서버가 아이폰에도 보냅니다. [APNs 키](https://developer.apple.com/account/resources/authkeys/list), [FCM iOS](https://firebase.google.com/docs/cloud-messaging/ios/client), [Capacitor 푸시](https://capacitorjs.com/docs/apis/push-notifications). `GoogleService-Info.plist`는 아직 저장소에 없습니다.
- **네이티브 QR 스캐너.** `@capacitor-mlkit/barcode-scanning`은 Swift Package가 없어 이번 iOS 패키지에 연결되지 않습니다. 웹 카메라로 여는 QR은 카메라 권한 문구로 동작합니다. 네이티브 스캐너가 필요하면 Mac에서 그 플러그인을 따로 붙입니다.

무음 스위치까지 무시하는 긴급 알림(Critical Alerts)은 Apple 승인 전입니다. 승인 전에 엔타이틀먼트를 넣으면 서명이 실패합니다. 절차는 `docs/mobile-build.md`의 iOS 알람 절에 있습니다.

## 9. 자동 업데이트 계획

화면만 바뀌는 수정은 스토어에 다시 올리지 않습니다. 안드로이드와 같은 Capgo(`@capgo/capacitor-updater`)가 아이폰 프로젝트에 이미 들어 있습니다. zip을 받아 두고, 앱을 벗어날 때 바꿉니다. 다음에 열면 새 화면입니다. 로그인 화면에서는 받지 않습니다. 조회 5초, 받기 90초, 적용 10초를 넘기면 로그인을 막지 않고 넘어갑니다.

애플은 웹뷰 안의 자바스크립트 갱신을 앱의 목적 안에서 허용합니다. 권한, 플러그인, 번들 아이디는 zip으로 못 바꿉니다. 그건 TestFlight와 앱스토어에 네이티브 빌드를 다시 올립니다. [Capacitor 업데이트 안내](https://capacitorjs.com/docs/guides/deploying-updates), [Capgo Updater](https://capgo.app/docs/plugins/updater/)

### 아이폰은 안드로이드 바닥을 보지 않는다

예전 조회는 `_platform: "android"`로 고정되어 있었습니다. 그 상태로 아이폰을 보관하면 화면 zip은 받아도, 플레이 설치 바닥(`min_native_version`)과 아이폰 빌드 번호가 한 칸에 섞입니다. 안드로이드에서 났던 「앱 업데이트가 필요합니다」 루프를 아이폰에 옮기지 않습니다. 규칙은 `docs/update-channels-2026-11-12.md`와 같습니다. 바닥 숫자는 안드로이드 행에만 남기고, 아이폰 행은 비웁니다.

### 넣는 순서

1. **데이터베이스.** `platform`에 `ios`를 더합니다. `get_latest_app_release`는 `ios`를 물으면 `ios` 행을 보고, 없을 때만 `shared`를 봅니다. `android` 행과 `desktop` 행은 보지 않습니다. `android`를 물으면 지금처럼 `android` 다음 `shared`만 봅니다. 기존 안드로이드·PC 행의 바닥 숫자는 고치지 않습니다. 최신 안드로이드 zip과 같은 파일을 가리키는 `ios` 행만 새로 만들고, 그 행의 바닥은 비웁니다.
2. **앱.** 조회는 `nativeOtaLookupPlatform`입니다. 안드로이드 폰은 `android`를 보냅니다. 아이폰은 `ios`를 보냅니다. 이 자바스크립트가 들어간 IPA가 첫 자동 업데이트 대상입니다.
3. **게시.** `both`는 같은 zip을 `android`, `desktop`, `ios`에 둡니다. 바닥 숫자는 안드로이드 행만 잇습니다. 아이폰 바닥에 숫자를 넣는 호출은 거절합니다. 아이폰 행 저장이 실패해도 안드로이드 게시는 남습니다.
4. **스토어 안내.** 아이폰은 바닥이 비어 있으면 안내하지 않습니다. `VITE_APP_STORE_URL`이 비어 있으면 앱스토어 버튼도 없고, 로그인 전에 화면을 막지 않습니다. 주소는 앱이 스토어에 올라온 뒤에 넣습니다. [앱스토어 링크](https://developer.apple.com/documentation/storekit/skstoreproductviewcontroller)
5. **확인.** 안드로이드 조회 결과와 바닥 숫자가 이 변경 전과 같은지, 아이폰 행의 바닥이 비었는지, 로그인 화면 코드가 zip을 받지 않는지를 확인합니다.

첫 IPA를 보관하는 시점의 화면 묶음에 2번이 들어 있어야, 그 다음부터 올리는 zip이 아이폰에 적용됩니다.
