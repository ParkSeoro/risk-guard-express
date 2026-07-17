## 원인 확정

문제는 마스터 권한 자체가 아니라 **소프트 삭제 방식과 조회 RLS 정책이 충돌**하는 구조입니다.

현재 삭제 버튼은 실제 삭제가 아니라 다음처럼 `permit_form_templates.is_deleted = true`로 바꾸는 업데이트를 실행합니다.

```ts
update({ is_deleted: true }).eq('id', t.id)
```

그런데 이 테이블의 조회 정책은 현재 다음 조건입니다.

```sql
is_deleted = false
```

PostgreSQL/Supabase RLS에서는 `UPDATE`가 실행될 때 `UPDATE` 정책만 보는 것이 아니라, 대상 row를 찾고 업데이트 후 결과 row를 처리하는 과정에서 `SELECT` 정책도 함께 영향을 줍니다. 그래서 `is_deleted`를 `true`로 바꾸는 순간 새 row가 `SELECT is_deleted = false` 정책을 만족하지 못해 `new row violates row-level security policy`가 발생합니다.

공식 문서 및 유사 사례에서도 같은 패턴이 확인됩니다:
- RLS 정책은 row가 조회/수정 가능한지를 명령마다 평가함
- `UPDATE`는 `USING`, `WITH CHECK`, 그리고 관련 `SELECT` 정책과 함께 평가될 수 있음
- soft delete 컬럼을 `SELECT` 정책에 직접 넣으면 삭제 업데이트가 막히는 대표적인 오류가 생김

## 수정 계획

1. **DB RLS 정책 재구성**
   - `permit_form_templates`의 조회 정책을 마스터와 일반 사용자로 분리합니다.
   - 일반 로그인 사용자는 기존처럼 삭제되지 않은 양식만 볼 수 있게 유지합니다.
   - 마스터는 삭제된 row까지 정책상 조회 가능하게 하여 `is_deleted=true` 업데이트가 RLS에서 막히지 않게 합니다.

2. **마스터 쓰기 정책 보강**
   - 생성/수정/삭제 정책은 `public.is_master(auth.uid())` 기준으로 통일합니다.
   - 정책 대상은 `authenticated`로 명확히 고정합니다.
   - `WITH CHECK`도 동일하게 적용해 저장, 기본양식 지정, 비활성화, 소프트 삭제가 모두 같은 기준으로 통과하게 합니다.

3. **데이터 API 권한 명시 보강**
   - `permit_form_templates`와 `permit_form_template_versions`에 로그인 사용자 및 서버용 명시 권한을 다시 부여합니다.
   - 이 작업은 RLS를 우회하지 않고, RLS가 정상 평가될 수 있도록 기본 테이블 접근 권한만 보강합니다.

4. **프론트 삭제 로직은 유지하되 결과 처리만 안정화**
   - 현재 삭제 방식(`is_deleted=true`)은 프로젝트 메모리의 soft delete 정책과 맞으므로 유지합니다.
   - 필요 시 삭제 후 선택 상태 초기화와 목록 재조회만 확인합니다.

5. **검증**
   - 적용 후 `pg_policies`로 실제 정책이 기대 상태인지 확인합니다.
   - `permit_form_templates`의 `SELECT`/`UPDATE` 정책 조합이 더 이상 soft delete를 막지 않는지 확인합니다.

## 예상 결과

- 마스터가 허가서 양식 디자인 화면에서 등록 양식을 삭제해도 RLS 오류가 더 이상 발생하지 않습니다.
- 일반 사용자는 계속 삭제되지 않은 활성 양식만 접근합니다.
- 삭제된 양식은 목록에서 사라지지만 DB에는 복구 가능한 상태로 보존됩니다.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>