# Lovable 제외 → Cursor + Vercel + Supabase

웹은 이미 Vercel에 연결되어 있습니다: https://risk-guard-express.vercel.app

이 문서의 **코드/문서 쪽은 레포에서 처리**합니다.  
아래 **당신만 할 수 있는 클릭**만 남으면 전환 완료입니다.

---

## 이미 된 것 (레포 / 인프라)

- [x] GitHub 소스: `ParkSeoro/risk-guard-express`
- [x] Vercel 프로덕션 배포 (homepage = `risk-guard-express.vercel.app`)
- [x] Supabase 프로젝트: `iqtiozscqwuacgzrlfzu`
- [x] README / 모바일 문서를 Lovable 비의존으로 정리
- [x] `vercel.json` SPA rewrite
- [x] `.env.example` 추가
- [x] Vite에서 `lovable-tagger` 제거 (에디터 전용)

## 당신만 하면 되는 것 (5분)

1. [ ] **Lovable → GitHub Sync 끄기 / Disconnect**  
   Lovable이 `main`에 계속 커밋하면 Cursor 작업과 충돌합니다.
2. [ ] **Vercel → Settings → Environment Variables** 확인  
   - `VITE_SUPABASE_URL`  
   - `VITE_SUPABASE_PUBLISHABLE_KEY`  
   - `VITE_SUPABASE_PROJECT_ID`  
3. [ ] **도메인이 Lovable에 묶여 있으면** Vercel로 이전 (없으면 skip)
4. [ ] **Lovable 플랜 해지/다운그레이드** (크레딧 중단)
5. [ ] (선택) 푸시 DB 설정 — Supabase SQL Editor:
   ```sql
   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://iqtiozscqwuacgzrlfzu.supabase.co';
   ALTER DATABASE postgres SET app.settings.service_role_key = '<Dashboard API의 service_role>';
   ```

## 일상 워크플로 (전환 후)

| 할 일 | 도구 |
|------|------|
| 기능/버그/UI | Cursor → PR → `main` merge |
| 웹 반영 | `main` push → Vercel 자동 |
| DB / Edge | Supabase Dashboard 또는 `npx supabase …` |
| 안드로이드 APK | `npm run build && npx cap sync android && cd android && ./gradlew assembleDebug` |

## 하지 말 것

- Lovable에 긴 프롬프트로 전체 재작성
- Capacitor `CAP_DEV_URL`에 `*.lovableproject.com` 넣기 (스토어/실기기 빌드 금지)
- Lovable Cloud Secrets에만 시크릿 두기 → Vercel + Supabase Dashboard로 이전

## 완료 판정

- [ ] Lovable 안 열고 `npm run dev` / Vercel URL 정상
- [ ] Lovable sync 끈 뒤에도 `main`이 Cursor/GitHub에서만 갱신
- [ ] 크레딧 소모 중단
