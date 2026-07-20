/**
 * 엑셀 그리드 표시/편집 컴포넌트.
 * - 병합(rowspan/colspan) · 컬럼폭 · 행높이 그대로 렌더.
 * - mode에 따라 셀 클릭·값 입력 방식이 달라진다.
 *    · designer: 아무 셀 클릭 → 입력 셀로 지정 (onDesignateCell)
 *    · fill: 지정된 셀만 인라인 입력 (onValueChange)
 *    · print: 값이 채워진 상태로 정적 렌더
 */
import { CSSProperties, memo, useMemo } from 'react';
import type { GridBook, GridCell } from '@/lib/xlsxGrid';
import { InputCell, KIND_COLOR, KIND_LABEL, findInputCell } from '@/lib/permitGridTypes';
import { Checkbox } from '@/components/ui/checkbox';

type Mode = 'designer' | 'fill' | 'print';

interface Props {
  book: GridBook;
  sheetIndex: number;
  inputCells: InputCell[];
  values?: Record<string, any>;
  mode: Mode;
  /** designer 모드에서 셀 클릭 시 */
  onDesignateCell?: (row: number, col: number) => void;
  /** fill 모드에서 값 변경 */
  onValueChange?: (fieldKey: string, value: any) => void;
  /** fill 모드에서 서명 클릭 (서명 패드 오픈) */
  onSignatureClick?: (input: InputCell) => void;
  /** designer 모드에서 이미 지정된 셀 클릭 → 편집 팝업 */
  onEditInput?: (input: InputCell) => void;
}

function GridSheetView({
  book,
  sheetIndex,
  inputCells,
  values = {},
  mode,
  onDesignateCell,
  onValueChange,
  onSignatureClick,
  onEditInput,
}: Props) {
  const sheet = book.sheets[sheetIndex];
  if (!sheet) return <div className="text-sm text-muted-foreground">시트가 없습니다.</div>;

  const colGroup = useMemo(
    () => sheet.colWidths.map((w, i) => <col key={i} style={{ width: w }} />),
    [sheet.colWidths],
  );

  return (
    <div className="w-full max-w-full overflow-auto border rounded bg-white" style={{ maxHeight: '75vh' }}>
      <table
        className="border-collapse text-[13px]"
        style={{ tableLayout: 'fixed', minWidth: sheet.colWidths.reduce((a, b) => a + b, 0) }}
      >
        <colgroup>{colGroup}</colgroup>
        <tbody>
          {sheet.cells.map((row, r) => (
            <tr key={r} style={{ height: sheet.rowHeights[r] }}>
              {row.map((cell, c) => {
                if (cell.hidden) return null;
                const input = findInputCell(inputCells, sheetIndex, r, c);
                const bg = input ? KIND_COLOR[input.kind] : undefined;
                const cellStyle: CSSProperties = {
                  border: '1px solid #d1d5db',
                  padding: '2px 4px',
                  verticalAlign: 'middle',
                  textAlign: cell.align || 'left',
                  fontWeight: cell.bold ? 600 : 400,
                  whiteSpace: cell.wrap ? 'normal' : 'nowrap',
                  overflow: 'hidden',
                  background: bg,
                  cursor: mode === 'designer' ? 'crosshair' : undefined,
                  position: 'relative',
                };
                const handleClick = () => {
                  if (mode !== 'designer') return;
                  if (input && onEditInput) onEditInput(input);
                  else onDesignateCell?.(r, c);
                };
                return (
                  <td
                    key={c}
                    rowSpan={cell.rowspan}
                    colSpan={cell.colspan}
                    style={cellStyle}
                    onClick={handleClick}
                  >
                    {renderCellContent(cell, input, values, mode, {
                      onValueChange,
                      onSignatureClick,
                    })}
                    {mode === 'designer' && input && (
                      <span
                        className="absolute top-0 right-0 text-[9px] px-1 bg-black/60 text-white rounded-bl"
                        title={input.field_key}
                      >
                        {KIND_LABEL[input.kind]}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCellContent(
  cell: GridCell,
  input: InputCell | undefined,
  values: Record<string, any>,
  mode: Mode,
  handlers: {
    onValueChange?: (k: string, v: any) => void;
    onSignatureClick?: (i: InputCell) => void;
  },
) {
  // designer 모드는 원본 텍스트만 보이고, 지정 셀은 배경/뱃지로만 표시
  if (!input) return <span>{cell.text}</span>;
  const val = values[input.field_key];

  if (mode === 'designer') {
    return (
      <span className="opacity-60">
        {cell.text || <em className="text-[10px]">[{input.field_key}]</em>}
      </span>
    );
  }

  // fill 또는 print
  if (input.kind === 'check') {
    if (mode === 'print') {
      return <span>{val ? '☑' : '☐'}</span>;
    }
    return (
      <Checkbox
        checked={!!val}
        onCheckedChange={(v) => handlers.onValueChange?.(input.field_key, !!v)}
      />
    );
  }
  if (input.kind === 'sign') {
    const img = typeof val === 'object' && val ? val.signature : val;
    if (mode === 'print') {
      return img ? (
        <img src={img} alt="서명" style={{ maxHeight: 36 }} />
      ) : (
        <span className="text-muted-foreground text-[11px]">서명 대기</span>
      );
    }
    return (
      <button
        type="button"
        className="text-[11px] underline text-primary"
        onClick={() => handlers.onSignatureClick?.(input)}
      >
        {img ? '서명됨 (변경)' : '서명하기'}
      </button>
    );
  }
  if (input.kind === 'date') {
    if (mode === 'print') return <span>{val || ''}</span>;
    return (
      <input
        type="date"
        className="w-full bg-transparent outline-none"
        value={val || ''}
        onChange={(e) => handlers.onValueChange?.(input.field_key, e.target.value)}
      />
    );
  }
  // text
  if (mode === 'print') return <span>{val || ''}</span>;
  return (
    <input
      type="text"
      className="w-full bg-transparent outline-none"
      value={val ?? ''}
      onChange={(e) => handlers.onValueChange?.(input.field_key, e.target.value)}
    />
  );
}

export default memo(GridSheetView);
