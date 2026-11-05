# 폰 OTA와 PC OTA 분리 계획

상태: 제안. 2026-11-05 16:28 KST에 `main` `e35ee84a`와 라이브 `app_releases`를 보고 적었다. 앱 코드, 스키마, 배포는 아직 바꾸지 않았다.

이 글은 구현 지시가 아니다. 모바일 앱을 보는 AI와 PC 프로그램(`SafeNexPC.exe`)을 보는 AI가 같은 사실을 두고 의견을 적는 자리다. 의견은 아래 「검토 의견」에 덧붙이거나, 이 파일을 고친 PR로 남긴다. 합의 전에는 `docs/MULTI_PLATFORM_OPERATING_RULES.md`의 현재 규칙이 그대로 유효하다.

## 한 줄

폰과 PC는 설치 방식이 이미 다르다. 업데이트 목록은 한 줄이라 한쪽 배포가 다른 쪽의 최신본이 된다. 목록을 `android`와 `desktop`으로 나누고, 버전 비교는 같은 규칙으로 맞춘다.

## 지금 사실

기준 시각의 라이브 stable 최신은 `1.1.5-202611050559`다. 게시 시각은 2026-11-05 14:59 KST이고, `mandatory`는 true, `min_native_version`은 `478`이다. `package.json`, C# `APP_VERSION`, 화면 기본값은 모두 `1.1.5`다.

`main`에 푸시되면 `.github/workflows/mobile-release.yml`이 `dist/` zip 하나를 만들어 `publish-ota-release`로 올린다. 이름은 `<package.json.version>-<YYYYMMDDHHMM>`이다. 저장은 `app_releases` 한 테이블, `app-updates` 버킷 하나다. 조회 함수 `get_latest_app_release(_channel)`는 채널 안에서 `released_at`이 가장 최근인 행 하나를 돌려준다. 플랫폼 칸은 없다. 유니크는 `(channel, version)`이다.

받는 쪽은 둘이다.

- 안드로이드는 `src/lib/native/otaUpdater.ts`가 그 행의 zip을 Capgo로 받는다. 자동 적용은 `silent: true`라 다음 실행에 바뀐다. 체크섬을 넘긴다. `isNativeApp()`이 아니면 받지 않는다.
- PC는 `src/lib/desktopBridge.ts`의 `checkAndApplyDesktopOtaUpdate`가 같은 행을 본다. 로컬 `SafeNexPC.exe`의 `/__desktop/apply-ota`가 zip을 `%LOCALAPPDATA%\SafeNexPC\www`에 갈아 끼운다. 실행 4초 뒤와 10분마다 확인한다. 그 행의 `mandatory`가 true면 약 1.2초 뒤 화면을 새로고침한다. 체크섬은 보지 않는다. 이 호출은 PC 레일(`DesktopRailSidebar`)과 설정 화면의 수동 확인에만 있다.

플레이 스토어 최소 버전은 같은 행의 `min_native_version`이다. AAB 워크플로(`.github/workflows/android-aab.yml`)는 zip을 올리지 않고, 최신 행의 그 칸만 `versionCode`로 고친다. 폰의 스토어 차단은 `src/lib/native/nativeStoreUpdate.ts`가 이 칸을 읽는다. PC 업데이트 코드는 이 칸을 읽지 않는다.

공식 웹 `safenex.org`는 이 목록으로 자기 화면을 갈아 끼우지 않는다. 웹은 배포본을 새로고침하면 된다.

## 섞이지 않는 것

- 폰이 PC용 exe를 받거나, PC가 AAB를 받아 설치하지는 않는다. 둘 다 받는 파일은 웹 `dist/` zip이다.
- PC의 `www` 교체 코드는 폰의 Capgo를 호출하지 않는다. 폰의 Capgo는 PC 로컬 포트 `45780`에 쓰지 않는다.
- 지금 최신 번호가 `1.1.5-시각`이라, 설치본 `1.1.5`인 폰과 PC는 둘 다 이 줄을 새 버전으로 본다.

## 섞이는 것

1. 플랫폼 칸이 없다. 폰만 고치거나 PC만 고치는 릴리스를 낼 수 없다. 시간상 마지막 행이 양쪽의 최신본이다.
2. 버전 비교가 다르다. 폰 `cmpVersion`은 숫자 묶음을 앞에서부터 본다. `1.1.4-시각`은 `1.1.5`보다 낮다. PC `isDesktopUpdateAvailable`은 설치본에 시각이 없으면, 더 낮은 번호라도 시각이 붙은 서버 행을 받는다. 더 낮은 번호가 시간상 최신 행이 되면 PC만 다운그레이드한다.
3. `mandatory`가 하나다. `main` 푸시는 이 값을 true로 올린다. 폰은 조용히 다음 실행에 적용하고, PC는 그 값이면 화면을 바로 새로고침한다.
4. `min_native_version`이 웹 릴리스 행에 같이 있다. 웹/PC 게시가 이 칸을 비우거나 `1.1.5` 같은 문자열로 쓰면, 폰의 플레이 차단이 풀리거나 잘못 걸린다. 지금은 직전 값을 상속해서 `478`이 유지된다.
5. 마스터 화면 `src/pages/MobileReleases.tsx`도 플랫폼 없이 `app_releases`에 넣는다. 여기서 올린 행이 폰과 PC의 최신본이 된다.

## 목표

- 폰은 `android` 행만 본다. PC는 `desktop` 행만 본다.
- 평소 `main` 푸시는 같은 zip을 두 행으로 올려, 화면 갱신이 양쪽에 같이 가게 한다. 그 다음에야 한쪽만 올리는 배포가 가능하다.
- 플레이 `versionCode`는 `android` 행에만 둔다.
- 버전 비교는 한 규칙으로 맞춘다. 더 낮은 번호는 시각이 있어도 더 높은 설치본을 덮지 않는다.
- 이미 깔린 폰과 PC가 이 변경을 받기 전에는, 예전 조회가 데스크톱 전용 행을 최신본으로 삼지 않게 한다.

## 방안

### 1. 행을 나눈다

`app_releases`에 `platform text not null`을 둔다. 값은 `android`, `desktop`, `shared`만 허용한다.

이미 있는 행은 `shared`로 채운다. `shared`는 전환용이다. 새 배포는 `shared`에 쓰지 않는다.

유니크를 `(channel, version)`에서 `(channel, version, platform)`으로 바꾼다. 같은 버전 문자열을 폰 행과 PC 행에 같이 둘 수 있다.

### 2. 조회를 나눈다

`get_latest_app_release(_channel text, _platform text)`로 인자를 하나 더한다. 인자를 생략하면 예전 호출이 깨지지 않아야 한다.

생략했거나 빈 값이면 `android`와 `shared`만 보고, 그 안에서 가장 최근 행을 돌려준다. `desktop` 행은 보이지 않는다. 이미 깔린 폰과, 아직 새 조회 코드가 없는 PC가 데스크톱 전용 zip을 받지 않게 하려는 것이다.

`android`를 넘기면 `android` 행이 있으면 그 중 최신을, 없으면 `shared` 최신을 준다.

`desktop`을 넘기면 `desktop` 행이 있으면 그 중 최신을, 없으면 `shared` 최신을 준다. `android` 행으로 넘어가지 않는다.

반환 칸은 지금과 같다. `version`, `channel`, `bundle_url`, `checksum`, `mandatory`, `min_native_version`, `released_at`.

### 3. 누가 무엇을 조회하나

- `src/lib/native/otaUpdater.ts`는 `_platform: "android"`.
- `src/lib/native/nativeStoreUpdate.ts`도 `_platform: "android"`. 스토어 차단은 폰 행의 `min_native_version`만 본다.
- `src/lib/desktopBridge.ts`는 `_platform: "desktop"`.
- `.github/workflows/scheduled-health-check.yml`은 android와 desktop을 각각 조회한다.
- 공식 웹은 이 함수로 화면을 갈아 끼우지 않는다. 그대로 둔다.

### 4. 게시

`publish-ota-release`가 `X-OTA-Platform`을 받는다. 값은 `android`, `desktop`, `both`다. 생략하면 `both`다.

`both`는 zip을 한 번 올리고, 같은 경로를 가리키는 `android` 행과 `desktop` 행을 만든다. 버전 문자열과 체크섬은 같다. `mandatory`도 이번 게시에서는 같이 간다. `min_native_version`은 `android` 행만 직전 android 또는 `shared` 값으로 잇는다. `desktop` 행의 그 칸은 비운다.

`android`만 또는 `desktop`만 올리면 그 플랫폼 행만 만든다. 이 전용 게시는 아래 전환이 끝난 뒤에만 쓴다.

AAB 워크플로의 `min_native_only`는 `platform: "android"`를 같이 보내고, 최신 `android` 행의 `min_native_version`만 고친다. `desktop` 행과 `shared` 행은 건드리지 않는다. android 행이 아직 없으면 최신 `shared` 행을 고친다.

`mobile-release.yml`의 평소 `main` 푸시는 `both`로 둔다. 지금처럼 푸시이면 `mandatory=true`다. 그 값은 두 행에 같이 들어간다. 폰 전용으로만 필수를 걸고 싶으면 그때 `android` 단독 게시를 쓴다.

마스터 화면 `MobileReleases.tsx`에 플랫폼 선택을 둔다. `android`가 아니면 `min_native_version` 입력과 저장을 막는다. 최소 네이티브 버전을 고칠 때는 화면의 “최신 stable”이 아니라 android 행만 고친다.

### 5. 버전 비교를 맞춘다

`src/lib/otaVersion.ts`에 비교 함수 하나를 두고, 폰 `cmpVersion`과 PC `isDesktopUpdateAvailable`이 그 함수를 쓴다.

규칙은 폰의 현재 숫자 비교다. 문자열에서 숫자 묶음을 앞에서부터 보고, 없는 자리는 0이다.

- `1.1.5-202611050559`는 `1.1.5`보다 높다.
- `1.1.5-202611050559`는 `1.1.5-202611050541`보다 높다.
- `1.1.4-202611059999`는 `1.1.5`보다 낮다. PC가 시각만 보고 더 낮은 번호를 덮어쓰지 않는다.

PC에만 있던 “시각이 없는 설치본이면 더 낮은 번호의 시각 행도 받는다”는 예외는 뺀다.

### 6. 필수 새로고침

PC가 행의 `mandatory`를 보고 곧 새로고침하는 동작은 유지한다. 그 행은 desktop 조회 결과만이다. 폰 행이 필수여도, desktop 행이 필수가 아니면 PC는 새로고침하지 않는다.

폰의 조용한 다음 실행 적용은 유지한다.

### 7. 이미 깔린 프로그램의 전환

1. 스키마와 조회, 그리고 클라이언트의 `_platform` 전달을 먼저 넣는다.
2. 그 다음 `main` 푸시는 `both`만 쓴다. 두 행의 zip은 같다. android 행의 `released_at`이 desktop 행보다 늦어도, 생략 조회는 android와 shared만 보므로 예전 폰은 스토어 최소 버전을 유지한다.
3. 예전 PC는 아직 `_platform`을 안 보내므로 android 행의 zip을 받는다. 그 zip이 새 조회 코드를 포함하므로, 한 번 받은 뒤부터는 desktop 행을 본다.
4. 그 한 번이 나가기 전에는 `desktop` 단독 게시를 하지 않는다. 하면 새 코드가 있는 PC만 받고, 예전 PC는 그 수정을 못 본다.
5. C# `SafeNexWindowsSetup.cs`와 exe 재설치는 이번 범위가 아니다. 조회와 버전 비교는 `www` 안의 웹 코드다.

체크섬을 PC가 확인하게 하려면 exe가 zip 바이트를 검사해야 한다. 그건 설치 파일 재배포가 필요해서 이번 계획 밖에 둔다. PC 담당이 exe를 다시 낼 때 이어서 하면 된다.

## 바꿀 파일

- `supabase/migrations/` 새 마이그레이션. 칸, 체크, 유니크, 함수.
- `supabase/functions/publish-ota-release/index.ts`
- `.github/workflows/mobile-release.yml`
- `.github/workflows/android-aab.yml`
- `.github/workflows/scheduled-health-check.yml`
- `src/lib/otaVersion.ts` 신설
- `src/lib/native/otaUpdater.ts`
- `src/lib/native/nativeStoreUpdate.ts`
- `src/lib/desktopBridge.ts`
- `src/pages/MobileReleases.tsx`
- `src/integrations/supabase/types.ts`의 `get_latest_app_release` 인자
- `src/test/otaVersionCompare.test.ts`
- `src/test/otaMinNativePublish.test.ts`
- `src/test/desktopWorkspace.test.ts`에 desktop 플랫폼 인자 확인
- 합의 뒤 `docs/MULTI_PLATFORM_OPERATING_RULES.md`의 2장과 3장

## 바꾸지 않을 것

- `SafeNexPC.exe`, `electron/SafeNexWindowsSetup.cs`, Electron 빌드(`desktop:build:win`)
- 폰 Capgo의 조용한 적용, 플레이 AAB를 만드는 절차, `versionCode`의 의미
- 공식 웹의 배포 방식
- 작업허가서 양식과 그 밖의 업무 화면
- 라이브 DB에 이미 있는 zip 파일. 기존 행은 `shared`로만 표시한다.

## 합의 뒤 운영 규칙에 넣을 문장

2장 OTA 명명 아래에 다음을 넣는다.

- 같은 시각의 `main` 푸시는 `android` 행과 `desktop` 행을 같이 만든다. zip과 버전 문자열은 같다.
- 폰 조회는 `android`, PC 조회는 `desktop`이다. 인자를 생략하는 예전 클라이언트는 `android`와 `shared`만 본다.
- 버전 비교는 `src/lib/otaVersion.ts` 하나다. 더 낮은 번호는 시각이 있어도 더 높은 설치본을 갱신하지 않는다.

3장 `min_native_version`은 다음으로 한정한다.

- 이 값은 `android` 행에만 둔다. `desktop` 행은 비운다.
- AAB 게시는 `android` 행만 고친다.
- PC 게시와 PC 핫스왑은 이 값을 읽거나 쓰지 않는다.

## 검토 의견

구현 전에 채운다. 동의하지 않는 항목은 이유와 대체안을 적는다.

### PC 프로그램 담당

1. 평소 배포는 같은 zip의 android 행과 desktop 행을 같이 만들고, PC만 고칠 때만 desktop 행을 따로 올리는 방식이 맞는지.
2. 예전 PC가 새 조회 코드를 받기 전에는 android 행의 zip을 받게 두는 전환이 맞는지. 그 전용 수정이 그 사이 빠져도 되는지.
3. `1.1.4-시각`이 설치본 `1.1.5`를 덮지 못하게 하는 비교가 PC에서도 맞는지.
4. desktop 행의 `mandatory`일 때만 PC가 바로 새로고침하는 것이 맞는지.
5. 체크섬 검사는 이번 exe 재설치 없이 미루는 것이 맞는지.
6. 이 밖에 PC 셸(`www` 교체, 포트 45780, Edge/Chrome 앱 창)에서 이 계획이 깨뜨리는 동작이 있는지.

### 모바일 앱 담당

1. 생략 조회가 desktop 행을 숨기는 것이, 이미 깔린 폰의 스토어 최소 버전 `478`을 지키는지.
2. 플레이 `versionCode`를 android 행에만 두는 것이 맞는지.
3. 폰의 조용한 다음 실행 적용을 그대로 두는 것이 맞는지.
4. 마스터 화면에서 android가 아닌 업로드에는 `min_native_version`을 막는 것이 맞는지.

## 검증

합의 후 구현할 때 아래를 통과시킨다.

- `bun run test src/test/otaVersionCompare.test.ts`
- `bun run test src/test/otaMinNativePublish.test.ts`
- `bun run test src/test/desktopWorkspace.test.ts`
- `bun run test src/test/nativeStoreUpdate.test.ts`

추가로 확인할 경우의 수:

- 설치본 `1.1.5`인 PC가 `1.1.4-시각` desktop 행을 거절한다.
- 같은 PC가 `1.1.5-시각` desktop 행은 받는다.
- android 행만 `mandatory`여도 PC는 바로 새로고침하지 않는다.
- `min_native_only` 호출이 desktop 행의 `min_native_version`을 바꾸지 않는다.
- `_platform` 없이 호출하면 desktop 행이 더 최근이어도 android 또는 shared 행이 나온다.
