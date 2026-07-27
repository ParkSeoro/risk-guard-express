# SafeNex (risk-guard-express)

건설현장 HSE SaaS — Vite · React · Supabase · Capacitor

| 역할 | 어디 |
|------|------|
| 소스 | GitHub `ParkSeoro/risk-guard-express` |
| 웹 배포 | [Vercel](https://risk-guard-express.vercel.app) (`main` 자동 배포) |
| DB / Auth / Edge | [Supabase](https://supabase.com/dashboard/project/iqtiozscqwuacgzrlfzu) |
| 코드 작업 | **Cursor** (Lovable 미사용) |
| 네이티브 앱 | Capacitor (`android/` / `ios/`) |

---

## 로컬 개발

```bash
git clone https://github.com/ParkSeoro/risk-guard-express.git
cd risk-guard-express
npm install
cp .env.example .env   # 값 채우기
npm run dev            # http://localhost:8080
```

필수 env (`.env` / Vercel Environment Variables):

```
VITE_SUPABASE_URL=https://iqtiozscqwuacgzrlfzu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
VITE_SUPABASE_PROJECT_ID=iqtiozscqwuacgzrlfzu
```

---

## 웹 배포 (Vercel)

- Production URL: https://risk-guard-express.vercel.app
- `main` 에 push 하면 자동 빌드 (`npm run build` → `dist`)
- SPA 라우팅은 `vercel.json` rewrites 사용

수동 확인:

```bash
npm run build
npm run preview
```

---

## 모바일 (Android 디버그 APK)

```bash
unset CAP_DEV_URL          # Lovable/원격 URL 넣지 말 것
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

자세한 절차: [`docs/mobile-deploy.md`](docs/mobile-deploy.md)

---

## Supabase

- Project ref: `iqtiozscqwuacgzrlfzu`
- 마이그레이션: `supabase/migrations/`
- Edge Functions: `supabase/functions/`

```bash
npx supabase link --project-ref iqtiozscqwuacgzrlfzu
npx supabase db push
npx supabase functions deploy
```

---

## Lovable

이 프로젝트는 **Lovable 없이** Cursor + GitHub + Vercel + Supabase 로 운영합니다.  
전환 체크리스트: [`docs/leave-lovable.md`](docs/leave-lovable.md)
