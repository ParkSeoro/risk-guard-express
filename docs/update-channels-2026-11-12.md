# 업데이트 채널 결론 (2026-11-12)

이 파일이 앱, 웹, PC 자동 업데이트의 현재 결론이다. 다른 AI는 이 파일을 먼저 읽고, 아래 「확인 절차」로 숫자를 다시 대조한다. 더 오래된 문서의 버전 숫자는 믿지 않는다.

기준 시각: 2026-11-12 오전 (한국시간). 라이브 DB는 Supabase 프로젝트 `qhntxmggacorqjjmjqgo`.

이 문서와 함께 한 일:

- 479였던 android 릴리스 두 줄(`1.1.8-202611100454`, `1.1.8-202611112336`)의 `min_native_version`을 **478**로 되돌렸다. Play가 사용자에게 주는 설치본이 478이기 때문이다. 뒤 줄은 `main` 푸시가 앞 줄의 479를 복사한 것이다.
- `.github/workflows/android-aab.yml`은 AAB를 GitHub에 만들어도 `min_native_version`을 올리지 않는다.
- 같은 워크플로의 versionName은 `package.json`의 `version`을 쓴다. 시크릿 `ANDROID_VERSION_NAME`은 더 이상 읽지 않는다.

하지 않은 일: Play 업로드, PR #663 머지, PC 설치 파일 게시, 웹 재배포.

## 채널은 네 개다

서로 대신하지 못한다.

1. **웹** `https://safenex.org`  
   `main`이 Vercel에 나가면 브라우저 새로고침으로 바뀐다. `app_releases`를 보지 않는다. 오래된 청크는 `src/lib/staleChunkError.ts`가 한 번 다시 받는다.

2. **폰 화면 (OTA)**  
   Capgo (`@capgo/capacitor-updater`)가 android 행의 zip을 받아 자바스크립트만 바꾼다. 네이티브 플러그인, 권한, versionCode는 못 바꾼다. 폰이 보는 최신 행은 `1.1.8-202611112336`, platform `android`, channel `stable`, `mandatory` true. 게시 시각 2026-11-11 23:36:09 UTC (한국시간 2026-11-12 08:36). 노트 `CI publish from a5d99af` (PR #664가 `main`에 합쳐지며 올라간 화면). 그 직전 화면은 `1.1.8-202611100454` (`feeb0125`, PR #662, 2026-11-10 13:54 한국시간)이다. #664는 허가서 종료 날짜만 바꿨고, 시작 때 Play 문구를 넣지 않았다.

3. **폰 설치본 (Google Play AAB)**  
   패키지 `org.safenex.app`. 네이티브 코드가 바뀔 때만 새 AAB가 필요하다. 앱을 지우면 Capgo가 받은 화면도 지워지고, Play가 주는 AAB로 돌아간다.

4. **PC**  
   화면은 desktop 행의 같은 zip이다. 로컬 `/__desktop/apply-ota`가 갈아 끼운다. `min_native_version`은 읽지 않고, desktop 행의 그 칸은 비어 있다. Electron 껍데기가 너무 오래되면 설치 파일을 한 번 실행해야 그 다음부터 화면만 자동으로 바뀐다. 화면만 바뀐 일에 설치 파일을 다시 요구하지 않는다. PC 버전 기본값은 `src/lib/desktopBridge.ts`의 `DESKTOP_DEFAULT_VERSION` (`1.1.8`)이다. 폰 versionCode와 같이 올리지 않는다.

## 왜 지우고 다시 깔아도 업데이트 문구가 남았나

Play에 올라간 마지막 성공 AAB는 2026-10-24 00:30 UTC (한국시간 09:30)이다.

- GitHub Actions run `40045307076`
- 커밋 `42c9e197`
- versionCode **478**. versionName은 워크플로 시크릿 `ANDROID_VERSION_NAME`이 `package.json`보다 우선이라 **1.1.0**으로 찍혔다.

그 커밋의 시작 경로는 스토어 문구를 띄운다.

- `src/main.tsx`가 `runBootStoreGate()`를 호출한다.
- `src/App.tsx`가 `NativeStoreUpdateGate`를 띄운다.
- 문구는 「앱 업데이트가 필요합니다」. Play 버튼과 「나중에 (오늘만)」이 있다.
- 비교는 `src/lib/native/nativeStoreUpdate.ts`의 `nativeNeedsStoreUpdate`: 설치 versionCode가 `min_native_version`보다 **작으면** 참이다.

2026-10-24 00:56 UTC 커밋 `6b67fb84`가 그 시작 문구를 뺐다. 이 커밋은 `42c9e197`의 조상이 아니다. 그래서 Play 478 설치본에는 문구가 남아 있다.

2026-11-10에 `main`의 화면(PR #662, 그리고 그 위를 덮은 `1.1.8-202611112336`)은 시작 때 그 문구를 띄우지 않는다. 현재 `src/main.tsx`는 `runBootOtaGate` 다음 `runPreLoginOta`만 호출한다. `runBootStoreGate`는 파일로만 있고 시작 경로에 없다. 한 번 OTA를 받은 폰은 문구가 사라진다.

2026-11-10 05:10 UTC (한국시간 14:10)에 AAB **479**를 만들었다.

- run `42760439581`, 커밋 `fe996ed2`, 브랜치 `cursor/store-then-ota-96eb` (PR #663, **머지되지 않음**)
- 아티팩트 이름 `safenex-1.2.0-479.aab`
- 그 워크플로의 마지막 단계가 당시 최신 android 행 `1.1.8-202611100454`의 `min_native_version`을 **479**로 저장했다. Play에 479를 올리기 전이었다.
- 2026-11-12 08:36 한국시간에 `main` 푸시가 새 화면 `1.1.8-202611112336`을 올렸다. 게시 함수는 직전 android 행의 바닥 버전을 그대로 복사하므로 이 행도 **479**였다.

2026-11-12 09:08 한국시간에 그 두 android 행을 **478**로 되돌렸다. desktop 행은 원래 비어 있었고 그대로다.

결과:

- 478을 지우고 다시 설치하면 Play가 478을 준다.
- 478 < 479 이므로 설치본 안의 문구가 다시 나온다.
- Play에는 받을 479가 없다. 버튼은 업데이트가 없는 스토어로 간다.
- 「나중에」는 하루만 숨긴다. 날짜 키 `safenex.nativeStoreSnoozeDate`는 UTC 날짜라 한국시간 아침에는 전날로 남을 수 있다. 루프의 원인은 이것이 아니다.

`min_native_version`을 478로 되돌리면 478 < 478 은 거짓이라 그 문구가 멈춘다. 478보다 낮은 설치본만 Play로 안내되고, Play에는 478이 있다.

## 다시 정한 규칙

- `min_native_version`은 **Play에서 사용자가 실제로 받는 versionCode**와 같다. 지금 그 값은 **478**이다. GitHub 아티팩트만 만들고 이 값을 올리지 않는다.
- 올리는 곳은 마스터 화면 `/app/admin`의 모바일 릴리스, 또는 `publish-ota-release`의 min-native-only 호출이다. AAB 워크플로는 호출하지 않는다. Edge Function이 그 입력을 받는 기능 자체는 사람이 Play 게시 뒤에 쓰도록 남겨 둔다.
- versionName은 `package.json`의 `version`이다. 지금 `main`은 `1.1.8`이다. 시크릿 `ANDROID_VERSION_NAME`으로 덮지 않는다.
- versionCode는 입력값, 그다음 `package.json`의 `androidVersionCode`, 그다음 시크릿 `ANDROID_VERSION_CODE`, 그다음 GitHub run number다. `main`의 `package.json`에는 `androidVersionCode`가 없다. 그래서 다음 AAB는 시크릿이 478이면 478로 만들어지고, Play는 같은 번호를 거절한다. 새 AAB를 Play에 올릴 때만 478보다 큰 번호를 `package.json`에 넣고, **그 번호가 Play에 열린 뒤에** `min_native_version`을 그 번호로 올린다.
- 화면 OTA 버전 문자열은 `<package.json.version>-<UTC YYYYMMDDHHMM>`이다. 플랫폼은 문자열이 아니라 `app_releases.platform` (`android` 또는 `desktop`)이다.
- 내장 화면이 `내장`, `0.0.0`, `builtin`이면 `src/lib/otaVersion.ts`의 `isOtaUpdateAvailable`이 서버 zip을 무조건 받는다. 더 높은 화면이 구워진 AAB를 먼저 깔면, 더 낮은 `1.1.8` OTA가 그 화면을 덮어쓴다. 그 거절은 PR #663의 `isNewerScreenRelease`에만 있고 `main`에는 없다. **그 비교가 AAB 안에 들어가기 전에는 1.2.0 AAB를 Play에 올리지 않는다.**
- 시작 순서는 나중에 이렇게 간다. 검사는 화면에 보이지 않는다. Play 화면은 설치본이 `min_native_version`보다 실제로 낮을 때만 나온다. 「업데이트 중」은 더 새로운 화면을 받는 동안에만 나온다. 버전 조회 5초, 받기 90초, 적용 10초를 넘기면 로그인으로 간다. 로그인 화면과 받기를 겹치지 않는다. `Auth.tsx`와 `workerAuth.ts`는 `CapacitorUpdater`를 호출하지 않는다. 조회는 `getOtaAnonClient`만 쓴다.
- 이 시작 순서는 PR #663에 있다. `min_native_version`이 479인 채로 #663을 머지하면, OTA를 받은 폰까지 재설치 루프와 같은 문구를 본다. **#663은 그대로 머지하지 않는다.** 버전 이름 우선순위와 내장 화면 다운그레이드 거절만 나중에 따로 가져온다.
- 웹 배포, PC 설치 파일, 폰 OTA, Play AAB를 한 버전 번호로 같이 올리지 않는다.

## 이미 고친 시작 먹통 (다시 열지 말 것)

PR #662 (`feeb0125`)가 `main`에 있다.

- 예전에는 `CapacitorUpdater.download`가 WebView를 멈추면 시작 화면이 영원히 「업데이트 중」에 머물렀다. 지금은 제한 시간이 지나면 로그인으로 간다. 시간이 지난 뒤에는 `set()`을 호출하지 않는다.
- 받기와 로그인이 겹치면 `signInWithPassword`와 근로자 전화 로그인이 「처리 중…」에서 멈췄다. 받기는 `App`을 올리기 전에 끝내거나 포기한다.
- 문구는 「업데이트 중」이다. 「화면을 받는 중」으로 되돌리지 않는다.
- 478 설치본에는 이 코드가 없다. 첫 실행은 10월 24일 자바스크립트다. 로그인 뒤 OTA가 한 번 성공해야 다음 실행부터 로그인 전에 받는다. 그 OTA는 지우면 사라진다.

## 확인 절차

다른 AI는 추측 대신 이것을 실행한다.

라이브 최신 행. android 최신 `1.1.8-202611112336`의 `min_native_version`은 `478`이어야 한다. desktop 최신은 그 칸이 비어 있어야 한다. `479`가 남은 android 행이 있으면 안 된다.

```sql
select version, platform, channel, mandatory, min_native_version, released_at
from public.app_releases
where coalesce(is_deleted, false) = false
order by released_at desc
limit 4;
```

Play 478 설치본에 문구가 있는지:

```bash
git grep -n -e NativeStoreUpdateGate -e runBootStoreGate 42c9e197 -- src/main.tsx src/App.tsx
git merge-base --is-ancestor 6b67fb84 42c9e197
```

두 번째 명령은 조상이 아니므로 실패(exit 1)가 맞다.

현재 `main`은 시작 때 스토어 문구를 띄우지 않는다.

```bash
git grep -n runBootStoreGate origin/main -- src/main.tsx
```

출력이 없어야 한다. `src/test/updatePromptQuiet.test.ts`와 `src/test/otaLoginSafety.test.ts`가 그 상태를 잠근다.

AAB 실행 기록:

```bash
gh run view 40045307076 --json headSha,createdAt,conclusion,headBranch
gh run view 42760439581 --json headSha,createdAt,conclusion,headBranch
```

워크플로가 아티팩트만으로 바닥 버전을 올리지 않는지:

```bash
git grep -n X-OTA-Set-Min-Native-Only .github/workflows/android-aab.yml
```

출력이 없어야 한다. Edge Function `supabase/functions/publish-ota-release/index.ts`에는 그 헤더 처리가 남아 있는 것이 맞다.

## 오래된 문서

숫자와 「지금 최신」 문장은 이 파일보다 아래가 우선하지 않는다.

- `docs/ota-phone-not-updating.md` — 2026-08-04. 잘못된 Supabase 프로젝트로 OTA가 가던 사고. 지금 프로젝트는 `qhntxmggacorqjjmjqgo`이다.
- `docs/ota-platform-split-plan.md` — 분리 전 계획. 플랫폼 칸은 이미 라이브에 있다. 최신을 `1.1.5`로 적지 말 것.
- `docs/MULTI_PLATFORM_OPERATING_RULES.md` — 채널 분리와 「desktop 행은 min_native를 비운다」는 여전히 맞다. 예시 숫자 478은 Play에 있는 번호로는 맞지만, 2026-11-10부터 2026-11-12 오전까지 라이브 값은 479였다.
- `docs/play-store-you-vs-me.md` — Play Console 업로드는 사람이 한다. 이 환경은 Play에 AAB를 올리지 못한다.

## 다음 AI가 하지 말 것

- `min_native_version`을 479로 되돌리지 말 것. 479 AAB가 Play에서 사용자에게 열린 것을 확인하기 전에는 어떤 번호로도 올리지 말 것.
- PR #663 (`cursor/store-then-ota-96eb`, `fe996ed2`)을 그대로 머지하지 말 것.
- 1.2.0 AAB를, 내장 화면이 더 낮은 OTA로 덮이지 않는 비교 없이 Play에 올리지 말 것.
- PC 설치 파일, 웹 배포, 폰 OTA를 이 문서의 수정이라고 같이 올리지 말 것.
- `src/test/updatePromptQuiet.test.ts`가 막는 시작 문구를 `App`이나 `main.tsx`에 다시 연결하지 말 것. Play 안내는 설치본이 실제로 낮을 때만, 그리고 Play에 그 번호가 있을 때만 나온다.
