# 현장 근로자 분포도 — SQL 오류 전체 분석

## 한 줄 요약
분포도 빨간 박스는 **앱/OTA 문제가 아니라** DB 함수 `get_worker_distribution_counts` 가
**실제 테이블에 없는 컬럼**을 참조해서 난 오류입니다. 마이그레이션 파일을 Git에만 두고
**운영 Supabase에 Run 하지 않으면** PC 웹에서도 계속 납니다.

---

## 데이터 흐름 (처음부터 끝까지)

```
출근(worker_gps_daily_lifecycle entry)
       → worker_entry_logs (오늘 미퇴근 = 현장 체류)
       → upsert_worker_last_position_from_checkin (좌표가 있으면)

폰 GPS → track-location Edge
       → worker_last_positions upsert (회사/구역/좌표, 개인식별 최소화)

관리자 PC 「현장 근로자 분포도」
       → supabase.rpc('get_worker_distribution_counts', { project_id })
       → 오늘 미퇴근 출근자 회사×구역 집계 (12시간 내 GPS가 있으면 구역, 없으면 미지정)
       → 사이트맵 위 숫자 / 구역별 인원 UI
```

필요한 DB 객체:
| 객체 | 역할 |
|------|------|
| `worker_last_positions` | 근로자별 최근 위치 1행 |
| `get_worker_distribution_counts(uuid)` | 집계 RPC (SECURITY DEFINER) |
| `can_access_company_data(...)` | 회사 스코프 권한 |
| `companies.type` | 회사 유형 (이름에 `_type` 접미사 없음) |
| `project_members` | 멤버십·역할 (`role_new`, `company_id` …) |

---

## 지금까지 난 오류와 원인

### 1) `column c.company_type does not exist`
- **잘못 쓴 이름:** `companies.company_type`
- **실제 컬럼:** `companies.type`
- **파일:** `20260804011000_fix_distribution_counts_company_type.sql`
- **교훈:** TypeScript/도메인에서 쓰는 `company_type` 별칭 ≠ DB 컬럼명

### 2) `column pm.is_active does not exist` ← 지금 화면
- **잘못 쓴 이름:** `project_members.is_active`
- **실제 `project_members` 컬럼 (운영 확인 2026-08-04):**
  `id, project_id, user_id, company, created_at, company_id, role_new, position_new`
- **`is_active` 없음.** 다른 테이블 습관으로 복사해 넣은 필터
- **파일:** `20260804030000_fix_distribution_counts_no_is_active.sql` (핫픽스)
- 이전 핫픽스(1번)를 적용해도 **같은 함수 안에 `is_active`가 남아 있어** 바로 다음 오류로 이어짐

---

## 왜 “고쳤는데도” 반복되나

1. **Git 머지 ≠ DB 적용**  
   마이그레이션 SQL은 레포에만 있고, Supabase에 자동 적용 파이프라인이 없으면 운영은 옛 함수 정의 그대로.
2. **부분 핫픽스**  
   `company_type`만 고친 `CREATE OR REPLACE`가 `is_active` 줄을 **그대로 유지**한 채 다시 배포됨.
3. **스키마 검증 없음**  
   RPC 작성 시 `information_schema` / `types.ts` 와 대조하지 않음.
4. **OTA/재설치와 무관**  
   이 화면은 웹 RPC 호출이라 폰 AAB와 별개. DB만 고치면 PC·폰 관리 화면 동시에 해결.

---

## 올바른 함수 조건 (체크리스트)

운영에 적용 전 반드시:

- [ ] `project_members`에 없는 컬럼 참조 없음 (`is_active` 금지)
- [ ] `companies.company_type` 금지 → `companies.type` 또는 join 불필요 시 제거
- [ ] `worker_last_positions` / `can_access_company_data` 존재
- [ ] `GRANT EXECUTE … TO authenticated`
- [ ] 적용 후: `pg_get_functiondef` 에 `is_active` / `company_type` 문자열 없는지 확인

---

## 지금 조치

1. 운영 DB에 `is_active` 제거한 `get_worker_distribution_counts` **적용 완료**(에이전트)
2. 레포 마이그레이션 추가 + 과거 파일에서도 `is_active` 줄 삭제
3. 분포도 UI 오류 메시지에 `is_active` / `company_type` 별도 안내

페이지 **새로고침** 하면 빨간 박스가 사라져야 합니다.  
인원 0은 “오늘 미퇴근 출근자가 없음”입니다. GPS가 없어도 출근자는 미지정 구역으로 집계됩니다.
