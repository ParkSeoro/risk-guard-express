# 모바일 네이티브 앱 빌드 & OTA 자동 업데이트 가이드

이 프로젝트는 Capacitor 기반 네이티브 쉘 + Capgo Updater(OTA) 구조로 동작합니다.

## 1. 최초 빌드 (한 번만)

Lovable에서 GitHub로 내보낸 뒤 로컬에서:

```bash
npm install
npx cap add ios       # macOS + Xcode 필요
npx cap add android   # Android Studio 필요
npm run build
npx cap sync
```

## 2. 권한 설정 (백그라운드 위치)

### iOS — `ios/App/App/Info.plist`
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>작업 중 위험구역 진입을 자동 감지해 알리기 위해 위치를 사용합니다.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>앱이 꺼져 있을 때도 위험구역 자동 감지가 필요합니다.</string>
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>fetch</string>
  <string>remote-notification</string>
</array>
```

### Android — `android/app/src/main/AndroidManifest.xml`
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

> 사용자가 Android 11+ 에서 "항상 허용"을 선택해야 백그라운드 추적이 유지됩니다. 앱 첫 실행 시 안내 다이얼로그를 추가하세요.

## 3. 스토어 배포

```bash
npm run build && npx cap sync
npx cap open ios      # Xcode → Archive → App Store Connect
npx cap open android  # Android Studio → Generate Signed Bundle
```

`capacitor.config.ts`는 `server.url`이 비어 있으면 동봉된 `dist/`를 로드합니다(OTA 가능). 개발 핫리로드는 `CAP_DEV_URL=https://...lovableproject.com npm run build`로 빌드하세요.

## 4. OTA 무선 업데이트 운영

스토어 재제출 없이 JS 번들만 교체하는 절차:

1. 코드 수정 후 로컬에서 `npm run build`
2. `dist/` 폴더를 zip으로 압축 (예: `cd dist && zip -r ../update-1.2.0.zip .`)
3. 마스터 계정으로 로그인 → **설정 → 모바일 앱 릴리스(OTA)** (`/settings/mobile-releases`)
4. 버전(예: `1.2.0`) · 채널(stable/beta) · zip 선택 → **업로드 및 게시**
5. 다음 앱 실행 시 자동으로 다운로드되어 적용됩니다 (필수 업데이트는 즉시 재시작)

### 채널 운영
- **stable**: 모든 사용자
- **beta**: 테스트 디바이스에서 `localStorage.setItem('app-update-channel','beta')` 적용 후 재시작

### 네이티브 변경 필요한 경우
다음 변경은 스토어 재제출이 필요합니다 (OTA로 불가):
- 새 권한 추가 (`Info.plist`/`AndroidManifest`)
- 새 Capacitor 플러그인 설치
- Capacitor / 네이티브 SDK 메이저 업그레이드

재제출 후 `min_native_version`을 올려 두면 구버전 네이티브 쉘에서는 OTA가 차단됩니다.

## 5. 금지구역 알람 최대 음량 (Android 네이티브)

Play 스토어 / Capacitor Android 셸에서만 동작합니다 (웹·PWA는 OS가 시스템 볼륨 강제 불가).

- 플러그인: `AlarmVolume` (`capacitor-plugins/alarm-volume + install.sh`)
- 동작: 경고 중 `STREAM_ALARM` + `STREAM_MUSIC`을 최대로 올리고, 사이렌을 `USAGE_ALARM`으로 재생한 뒤 종료 시 볼륨 복구
- 권한: `MODIFY_AUDIO_SETTINGS`, `VIBRATE`
- 웹/PWA 보완: 강한 진동 패턴 + 전체화면 점멸 (`alarmHaptics` / `DangerZoneAlertModal`)
- 네이티브 변경이므로 **스토어 재빌드·재제출** 필요 (`npx cap sync` 후 Archive/Bundle). OTA만으로는 Java 플러그인이 배포되지 않습니다.

마스터 시뮬레이터(모바일 메뉴)로 알람 사이클을 검증하세요.

## 6. 푸시 알림 (선택)
- Android: Firebase Console → `google-services.json` → `android/app/`
- iOS: Apple Developer → APNs Key → Xcode Capabilities → Push Notifications

`send-push` 엣지 함수와 `push_subscriptions` 테이블이 이미 구성되어 있습니다.

## 트러블슈팅
- 위치가 백그라운드에서 끊긴다 → "항상 허용" 및 배터리 최적화 해제 안내
- OTA 적용 후 화이트스크린 → `appReadyTimeout: 5000`이 자동 롤백
- 강제로 이전 번들 복구 → `CapacitorUpdater.reset()` 호출 라우트를 추가하거나 앱 재설치
