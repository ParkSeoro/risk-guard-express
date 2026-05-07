# 시스템 테스트 엔진 (System QA Engine)

운영 시스템과 **분리된 제3자 검증 엔진**. 마스터 전용. 새 기능 추가 / 기존 기능 수정시 회귀(regression) 검증용으로 사용한다.

## 구조

```
src/lib/systemTest/
├── runner.ts        실행/집계/정리 엔진
├── manifest.ts      기능 ↔ 테스트 매핑 + 기대 스키마/RPC
├── scenarios.ts     14개 시나리오 (admin, contractor, worker, perm, flow,
│                    notify, integ, schema, rpc, edgefn, audit, e2e,
│                    drift, coverage)
└── README.md        본 문서
```

## 검증 레이어

| 레이어 | 시나리오 | 잡는 것 |
|---|---|---|
| 단위 happy path | `admin / contractor / worker` | 각 페르소나 단일 동작 |
| 부정 입력 | `worker.*_rejected`, `contractor.*_invalid`, `perm.user_roles_protected` | 잘못된 입력이 거부되는지 |
| 데이터 무결성 | `integ` | INSERT 후 SELECT 일치, 트리거, FK, soft delete |
| 권한/RLS | `perm` | 마스터/타프로젝트/role 보호 |
| **E2E 페르소나 체인** | `e2e` | 관리자→시공사→근로자 데이터가 끊기지 않는지 |
| 스키마/RPC 드리프트 | `drift` | 기대 컬럼·RPC 시그니처가 사라지면 즉시 FAIL |
| 인프라 헬스 | `schema / rpc / edgefn / audit` | 테이블·RPC·엣지함수 도달성 |
| **커버리지 매니페스트** | `coverage` | manifest.ts 에 등록된 기능 영역이 실제 검증되는지 |

## 새 기능을 추가할 때 반드시 해야 하는 것

1. **시나리오에 step 추가** — `scenarios.ts` 의 적절한 함수에 `runStep("scenario_key", "step_key", ...)` 추가. 새 흐름이면 새 함수를 만들고 `SCENARIOS` 에 등록.
2. **manifest.ts 갱신**
   - `FEATURE_COVERAGE` 에 `"새 기능 이름": ["scenario_key.step_key", ...]` 추가
   - 새 테이블이면 `REQUIRED_COLUMNS` 에 핵심 컬럼 등록
   - 새 RPC면 `REQUIRED_RPCS` 에 이름과 sample_args 등록
3. **E2E 체인에 영향 있으면** `runE2EChainScenario` 의 끝부분(`chain_integrity`)에 새 링크 검증 추가
4. 마스터 계정으로 `/admin/system-test` → 전체 실행 → 100점 확인 후 머지

manifest 에 등록만 하고 시나리오 step 을 안 만들면 `coverage` 시나리오가 자동으로 FAIL 시킨다 — 그래서 누락이 회귀로 나타난다.

## 안전장치

- 모든 테스트 데이터는 `__QA__` 접두사 + `qa_run_id` 태그 + `system_test_artifacts` 추적 → 종료 시 `cleanupRun()` 으로 일괄 soft-delete
- 운영 코드 수정 금지. 본 폴더 + `manifest.ts` + (필요시) `qa_*` SECURITY DEFINER RPC 만 추가
- `EMAIL_OVERRIDE` 로 외부 알림 발송 차단 (개발 모드)

## 결과 해석

- **PASS 100%** : 회귀 없음. 머지 OK.
- **FAIL on `drift.*`** : 마이그레이션이 기대 스키마/RPC를 깼다 → manifest 또는 마이그레이션 수정.
- **FAIL on `e2e.chain_integrity`** : 페르소나간 데이터 링크가 끊겼다 → FK / 트리거 / 폼 저장 로직 검토.
- **FAIL on `coverage.*`** : 새 기능을 만들었는데 테스트를 안 등록했다 → manifest + scenarios 동기화.
