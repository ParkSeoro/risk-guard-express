# #23 기준정보 마스터 (MasterData)

## 범위
- `master_processes`, `master_ppe`, `legal_references`, `validation_rules`, 위험도 매트릭스, 담당자 매핑.
- 장비/모델은 프로젝트별 `equipment_master` (별도 EquipmentManager 컴포넌트).

## 품질 8차원 적용
1. **데이터 정합성** – 모든 마스터에 `is_deleted` 소프트삭제 통일. `useSoftDelete` + 사유 강제. `legal_references`/`validation_rules` 는 하드삭제 + 사유 + 감사 로그.
2. **권한 가드** – `isAdmin()` 만 추가/수정/삭제 표시.
3. **로딩 상태** – Skeleton 행 표시 (탭별).
4. **빈 상태 / 검색 결과 없음** – 등록 0건과 필터 0건을 분리 메시지.
5. **검색** – 공정/PPE/법령/규칙 각 탭에 인라인 검색 인풋 (이름·분류·조문·설명·매핑 OR 매칭).
6. **요약 KPI** – 상단에 공정/PPE/법적근거(검토필요)/검증규칙(활성/전체) 카드.
7. **실시간** – `master_processes`, `master_ppe`, `legal_references`, `validation_rules` Realtime 구독으로 즉시 반영.
8. **감사/SSOT** – 삭제는 모두 사유 필수 + audit_logs 기록.

## 알려진 제약
- 위험도 매트릭스는 클라이언트 로컬 (`getMatrixConfig`) → 추후 DB 동기화 검토.
- EquipmentManager 는 하드삭제 (사유 필수 prompt). 추후 `is_deleted` 컬럼 도입 시 `useSoftDelete` 로 일원화.
