# Safenex 아이폰 앱

지금 웹 화면을 그대로 아이폰 껍데기로 감쌉니다. 새 화면을 만들지 않습니다. 번들 아이디는 안드로이드와 같은 `org.safenex.app`입니다. 웹 서버와 안드로이드 설치본은 이 작업으로 바뀌지 않습니다.

이 저장소에 Xcode 프로젝트 `ios/`가 있습니다. 컴파일, 서명, 앱스토어 업로드는 Mac에서만 됩니다.

## 이미 넣어 둔 것

| 항목 | 값 |
| --- | --- |
| 프로젝트 | `ios/App/App.xcodeproj` |
| 표시 이름 | Safenex |
| 번들 아이디 | `org.safenex.app` |
| 버전 | `1.1.9` (빌드 번호 `479`, 안드로이드 `androidVersionCode`와 같음) |
| 권한 문구 | `ios/App/App/Info.plist` (위치, 카메라, 사진, 백그라운드 위치·알림) |
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

1. [App Store Connect 앱 목록](https://appstoreconnect.apple.com/apps)에서 새 앱을 만듭니다.
2. 플랫폼 iOS, 이름 Safenex, 기본 언어 한국어, 번들 ID `org.safenex.app`, SKU는 `safenex-ios`처럼 고유한 글자입니다.
3. 개인정보 처리방침 URL은 지금 쓰는 주소입니다. [https://safenex.org/privacy](https://safenex.org/privacy)

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

카테고리는 비즈니스, 연령은 18세 이상, 광고 없음으로 맞춥니다. 안드로이드 스토어 문구와 같습니다.

위치는 출근과 현장 위험구역용입니다. 백그라운드 위치는 심사가 엄격합니다. 심사 메모에 현장 안전 관리이며 사용자가 출근 화면에서 직접 켠다고 적습니다. 안내: [위치 권한 심사](https://developer.apple.com/app-store/review/guidelines/#location), [백그라운드 위치](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background)

개인정보 질문: [App Privacy](https://developer.apple.com/app-store/app-privacy-details/). 안드로이드 데이터 보안과 같이 위치, 사진, 이름, 이메일, 전화, 앱 활동을 수집한다고 표시합니다. 판매 목적 공유는 아닙니다.

스크린샷은 6.7인치 아이폰이 필수입니다. 근로자 홈과 출근 화면이면 됩니다.

## 8. 푸시와 QR은 첫 설치 뒤에 이어서

첫 TestFlight는 로그인과 출근 확인용입니다. 아래 둘은 껍데기만으로 끝나지 않습니다.

- **푸시.** 안드로이드는 FCM입니다. 아이폰은 Apple 푸시 키(APNs)를 Firebase iOS 앱에 넣어야 같은 서버가 아이폰에도 보냅니다. [APNs 키](https://developer.apple.com/account/resources/authkeys/list), [FCM iOS](https://firebase.google.com/docs/cloud-messaging/ios/client), [Capacitor 푸시](https://capacitorjs.com/docs/apis/push-notifications). `GoogleService-Info.plist`는 아직 저장소에 없습니다.
- **네이티브 QR 스캐너.** `@capacitor-mlkit/barcode-scanning`은 Swift Package가 없어 이번 iOS 패키지에 연결되지 않습니다. 웹 카메라로 여는 QR은 카메라 권한 문구로 동작합니다. 네이티브 스캐너가 필요하면 Mac에서 그 플러그인을 따로 붙입니다.

무음 스위치까지 무시하는 긴급 알림(Critical Alerts)은 Apple 승인 전입니다. 승인 전에 엔타이틀먼트를 넣으면 서명이 실패합니다. 절차는 `docs/mobile-build.md`의 iOS 알람 절에 있습니다.

## 9. 올린 뒤의 화면 수정

화면만 바꾸는 수정은 지금 안드로이드와 같이 OTA로 갑니다. 권한 문구, 플러그인, 번들 아이디를 바꾸면 TestFlight와 스토어에 네이티브 빌드를 다시 올립니다.
