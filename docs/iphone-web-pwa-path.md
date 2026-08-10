# iPhone 이용 경로 (App Store 없음)

iPhone/iPad는 Capacitor App Store 빌드가 없습니다. **Safari 웹 = `/app/worker` 동일 셸**이 공식 경로입니다.

## 권장 흐름

1. 등록 QR → `/worker/register?project=&company=`
2. 「Safari에서 가입 계속」→ `/register?audience=worker&…`
3. 동의 → `/app/worker/today`
4. Safari 공유 → **홈 화면에 추가** (푸시·앱형 UI)

## Android와의 차이 (불가피)

| 기능 | iPhone 웹/PWA | Android 앱 |
|------|---------------|-------------|
| 업무 화면·결재·TBM 등 | 동일 | 동일 |
| 전경 GPS·인앱 위험구역 모달 | 가능 | 가능 |
| 백그라운드 GPS | 제한 | 가능 |
| 무음/Critical 사이렌 | 불가 | 가능 |

## 코드

- `src/lib/iosWebPath.ts` — iOS 웹 감지
- `WorkerRegister.tsx` / `Auth.tsx` — Play CTA 숨김, PWA 안내
- `InstallPrompt.tsx` — `/worker/register` 포함
- `manifest.json` `start_url` → `/app/worker/today`
