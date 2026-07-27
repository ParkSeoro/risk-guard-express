# SafeNex 네이티브 앱 빌드·배포 매뉴얼

Cursor + GitHub + Vercel + Supabase 기준으로 iOS / Android 출시와 OTA 갱신 절차입니다.  
**Lovable 프리뷰 URL은 사용하지 않습니다.**

---

## 0. 사전 준비물

| 대상 | 도구 / 계정 |
| --- | --- |
| 공통 | Node.js 20+, Git, GitHub |
| 웹 | Vercel (`https://risk-guard-express.vercel.app`) |
| 백엔드 | Supabase project `iqtiozscqwuacgzrlfzu` |
| iOS | macOS + Xcode 15+, Apple Developer ($99/년) |
| Android | Android Studio + JDK 17+, Google Play Console ($25 1회) |

---

## 1. 로컬 셋업

```bash
git clone https://github.com/ParkSeoro/risk-guard-express.git
cd risk-guard-express
npm install
cp .env.example .env   # VITE_SUPABASE_* 채우기
```

---

## 2. 네이티브 플랫폼 (최초 1회)

```bash
npx cap add android
# Mac 만: npx cap add ios

# 권한 자동 주입 (스크립트가 있으면)
node scripts/prepare-native.mjs
```

---

## 3. 개발 중 — 디바이스 핫리로드 (선택)

로컬 Vite를 폰에서 보려면 PC LAN IP를 씁니다. **Lovable URL 금지.**

```bash
# 예: PC가 192.168.0.10 일 때
CAP_DEV_URL="http://192.168.0.10:8080" npx cap sync android
npm run dev
npx cap run android
```

출시·내부 배포 APK에는 `CAP_DEV_URL` 을 절대 넣지 마세요.

---

## 4. 출시용 빌드

```bash
unset CAP_DEV_URL
npm run build
npx cap sync
```

### 4-1. Android — 디버그 APK / 릴리스 AAB

```bash
cd android
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk

./gradlew bundleRelease
# → app/build/outputs/bundle/release/app-release.aab
```

서명 키는 Android Studio → **Generate Signed Bundle** 후 Play App Signing에 등록.

### 4-2. iOS

```bash
npx cap open ios
```

Xcode → **Product → Archive** → App Store Connect 업로드.

---

## 5. 스토어 등록

### Google Play
1. 앱 만들기 — applicationId: `org.safenex.app` (`capacitor.config.ts` 기준)
2. 내부 테스트 트랙에 AAB 업로드
3. 데이터 보안·개인정보처리방침 URL 입력
4. 스크린샷·아이콘 등록 후 프로덕션

### App Store Connect
1. Bundle ID 동일하게 등록
2. TestFlight → 심사 제출

---

## 6. OTA 업데이트 (웹 번들만)

```bash
git pull
npm run build
node scripts/ota-bundle.mjs 1.0.1   # releases/safenex-1.0.1.zip
```

1. 마스터 계정으로 로그인
2. `/settings/mobile-releases` 에서 zip 업로드
3. 다음 앱 실행 시 다운로드·적용 (`notifyAppReady` 실패 시 롤백)

OTA 가능: UI/라우트/Supabase 호출 로직  
OTA 불가: 플러그인·권한·네이티브 변경 → 스토어 재빌드

GitHub Actions: `.github/workflows/mobile-release.yml`  
(`main` push / `v*` 태그 / 수동 Run workflow)

---

## 7. 트러블슈팅

| 증상 | 조치 |
| --- | --- |
| 심사 "remote URL" / 최소 기능 | `CAP_DEV_URL` 제거 후 재빌드 |
| 백그라운드 위치 안 됨 | OS "항상 허용" + FG 알림 확인 |
| OTA 흰 화면 | Capgo `appReadyTimeout` 롤백 → 번들 재배포 |
| 푸시 안 옴 | FCM `google-services.json` / APNs / VAPID·device_push_tokens |

---

## 8. 연락

- 개인정보: privacy@safenex.org
- 사고 보고: `/incidents`
