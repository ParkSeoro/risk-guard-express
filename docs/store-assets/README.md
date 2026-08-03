# Play Store 시각 자산

| 파일 | 용도 | 크기 |
|------|------|------|
| `../public/icon-512.png` | 스토어 / 앱 아이콘 (후보 B) | 512×512 PNG |
| `../public/icon-192.png` | PWA / 웹 사이드바·BrandMark | 192×192 PNG |
| `../public/favicon.png` | 브라우저 탭 파비콘 | 32×32 PNG |
| `../public/favicon.svg` | 벡터 파비콘 (Icon B) | SVG |
| `feature-graphic-1024x500.png` | Play 피처 그래픽 (한글 포함) | 1024×500 PNG |
| `candidates/icon-b-source.png` | 선정된 원본 후보 | — |

## 알림 아이콘 (흰 실루엣)

Android 상태바는 **흰 알파 실루엣**만 사용합니다. 컬러 런처 아이콘을 쓰면 흰 네모로 보입니다.

- 소스: `native-assets/android-res/res/drawable/ic_stat_safenex.xml` (+ density PNG)
- CI/`prepare-native` → `scripts/sync-android-brand-assets.py` 가 `android/app/src/main/res` 에 복사
- FCM payload `notification.icon = ic_stat_safenex`

스크린샷(폰 2장 이상)은 Play Console에 직접 업로드하세요.  
권장 캡처 화면: 근로자 홈, 메뉴, 결재 대기, 안전점검.

## 백그라운드 위치 선언용 데모 영상

Play Console 「민감한 앱 권한」 제출용 (약 20초).

| 파일 | 설명 |
|------|------|
| `safenex-bg-location-demo.mp4` | 안내 → 항상 허용 → 추적 → 금지구역 경보 |
| `bg-loc-demo-1-disclosure.png` … `4-…` | 동일 장면 스틸컷 |

1. YouTube에 **일부 공개/비공개**로 업로드  
2. 선언 폼에 YouTube URL 붙여넣기  

> 심사에서 실기기 촬영을 요구하면, 같은 순서로 폰에서 다시 찍으면 됩니다.

