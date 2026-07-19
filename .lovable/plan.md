## 원인

`교육자료 자동 생성` 버튼이 호출하는 엣지 함수 `generate-education-material` 이 부팅 직후 크래시하고 있어 브라우저에는 "Failed to send a request to the Edge Function" 로 표시됩니다.

엣지 함수 로그(최근):
```
TypeError: sb.auth.getClaims is not a function
  at requireUser (.../generate-education-material/index.ts:23)
```

`supabase-js@2.45.4` 에는 `auth.getClaims()` 메서드가 존재하지 않습니다. (이 메서드는 훨씬 최신 버전에서만 제공) 그래서 요청이 들어오자마자 인증 체크 단계에서 예외가 던져지고, 함수가 500으로 죽어 클라이언트가 네트워크 에러로 인식합니다.

동일 파일 안에서 이후 프로젝트 멤버 검증(`is_project_member` RPC)도 하고 있으므로, 토큰 검증은 표준 방식인 `auth.getUser(token)` 로 바꾸면 됩니다.

## 해결 방안

`supabase/functions/generate-education-material/index.ts` 의 `requireUser` 만 아래처럼 교체:

- `sb.auth.getClaims(token)` → `sb.auth.getUser(token)`
- 사용자 ID는 `data.user.id` 에서 추출
- 나머지 로직(멤버 검증, Gemini 호출, 응답)은 그대로 유지

수정 후 함수는 자동 재배포되며, 교육자료 관리 화면에서 "AI 자동 생성" 다시 시도하면 정상적으로 Gemini 응답이 반환됩니다.

## 검증

- Playwright 없이도 `supabase--curl_edge_functions` 로 `/generate-education-material` 에 `project_id` 를 실어 POST → 401/403/200 중 하나가 나오면 크래시가 사라진 것.
- 프리뷰에서 실제 자동 생성 버튼 클릭 → 토스트가 "생성 실패" 대신 성공/구체 오류로 바뀌는지 확인.
