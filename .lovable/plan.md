## 목표
허가서 작성 시 라벨(작업명/작업내용/작업지역/기타/비고/투입장비)이 위에 뜨고 입력칸이 아래 줄로 밀려서 A4 한 장을 넘치는 문제를 해결한다. 라벨과 입력칸을 같은 줄에 붙여 표시한다.

## 원인
`DigPermitForm.tsx`의 `PermitInput` 은 `w-full` 스타일이 걸린 `<input>` 이라, `<td>` 안에서 `"작업명 : " <Inp/>` 처럼 텍스트 노드 뒤에 놓으면 input 이 가용 폭 100% 를 차지하며 다음 줄로 내려간다.

## 수정 방식
각 해당 셀 내부를 `flex items-center gap-1` 컨테이너로 감싸고, 라벨은 `shrink-0 whitespace-nowrap`, 입력칸은 `flex-1` 로 배치한다. 표 구조(colspan/셀 위치)는 건드리지 않는다. 시각/인쇄 폭만 정리되므로 로직·데이터 바인딩·IME 처리는 그대로 유지.

## 대상 (src/components/permits/DigPermitForm.tsx)
- L431 작업명
- L433 작업내용
- L435 작업지역(장소)  (작업인원 옆 셀은 이미 한 줄이라 손대지 않음)
- L446 첨부서류의 "기타 ( ___ )"
- L507 투입장비
- L519 비고
- L314 비고/세부사항 (밀폐/화기 공용 비고 셀 — 동일 증상)

## 예시 (작업명)
```tsx
<td colSpan={5}>
  <div className="flex items-center gap-1">
    <span className="shrink-0 whitespace-nowrap">작업명 :</span>
    <Inp className="flex-1" value={data.work_name} onChangeText={(v) => update({ work_name: v })} />
  </div>
</td>
```
기타 5개 항목도 동일한 패턴으로 통일.

## 범위 밖
- 표준양식 스타일 편집기, PDF 오버레이, 결재 로직: 변경 없음
- 모바일/데스크탑 데이터 필드: 변경 없음