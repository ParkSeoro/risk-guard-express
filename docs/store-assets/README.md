# Play Store 시각 자산

| 파일 | 용도 | 크기 |
|------|------|------|
| `../public/icon-512.png` | 스토어 / 앱 아이콘 (후보 B) | 512×512 PNG |
| `../public/icon-192.png` | PWA / 보조 아이콘 | 192×192 PNG |
| `feature-graphic-1024x500.png` | Play 피처 그래픽 (한글 포함) | 1024×500 PNG |
| `candidates/icon-b-source.png` | 선정된 원본 후보 | — |

## 알림 아이콘 (흰 실루엣)

Android 상태바는 **흰 알파 실루엣**만 사용합니다. 컬러 런처 아이콘을 쓰면 흰 네모로 보입니다.

- 소스: `native-assets/android-res/res/drawable/ic_stat_safenex.xml` (+ density PNG)
- CI/`prepare-native` → `scripts/sync-android-brand-assets.py` 가 `android/app/src/main/res` 에 복사
- FCM payload `notification.icon = ic_stat_safenex`

스크린샷(폰 2장 이상)은 Play Console에 직접 업로드하세요.  
권장 캡처 화면: 근로자 홈, 메뉴, 결재 대기, 안전점검.
