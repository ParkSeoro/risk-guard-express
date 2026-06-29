---
name: Central consistency primitives
description: Centralized infra to satisfy IME, term standardization, Zod, and audit log audit rules — use these first, do not duplicate per-page.
type: preference
---
공통 법칙(IME 한글 안정성 / 용어 표준화 / Zod 검증 / 감사 로그)은 **중앙화된 컴포넌트·라이브러리**를 통해 만족시킨다. 페이지마다 따로 처리하지 말 것.

## 사용 규칙

1. **모든 한글 텍스트 입력 = `IMESafeInput`** (`src/components/IMESafeInput.tsx`)
   - `<Input>` 직접 사용 금지(한글 필드인 경우). IME 보호 + 용어 표준화(굴삭기→굴착기 등)가 커밋 시 자동 적용됨.
   - 비한글 필드(전화번호, URL, 코드)는 `applyTermCorrection={false}` 명시.

2. **모든 폼 검증 = `src/lib/commonSchemas.ts`**
   - `koreanName`, `phoneKR`, `phoneKROptional`, `shortText`, `longText`, `emailField`, `urlOptional`, `uuid`, `nonNegInt`, `safeFileName` 재사용.
   - 에러 표시: `zodErrorMessage(parsed.error)` → toast/setError.
   - 페이지별 ad-hoc `if (!x.trim())` 검사 금지.

3. **모든 중요 CRUD = `useAuditLog`** (`src/hooks/useAuditLog.ts`)
   - 작성/수정/삭제/승인 직후 `log(action, targetType, targetId, projectId, details)` 호출.

4. **모든 삭제 = `useSoftDelete`** (기존 SSOT 규칙)
   - 직접 `.delete()` 금지.

## Why
- IME 36개, Zod 27개, 감사 23개, 용어 12개 누락이 중앙화 부재 때문이었음.
- 한 곳에서 고치면 모든 페이지에 전파.

## How to apply
- 새 페이지/신규 코드: 위 4개 프리미티브를 무조건 우선 적용.
- 기존 페이지 수정 시: 손대는 김에 `<Input>` → `IMESafeInput`로 교체.
- ZoneCheckin.tsx가 모범 사례.
