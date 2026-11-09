/** Pixels of the chat column that sit below the visible screen (keyboard). */
export function keyboardCoveredPixels(opts: {
  parentTop: number;
  parentHeight: number;
  viewportOffsetTop: number;
  viewportHeight: number;
}): number {
  const visibleBottom = opts.viewportOffsetTop + opts.viewportHeight;
  const available = visibleBottom - opts.parentTop;
  return Math.max(0, Math.round(opts.parentHeight - available));
}

export function messengerComposerPlaceholder(compact: boolean): string {
  return compact
    ? "메시지 입력"
    : "메시지 입력 (Enter: 전송, Shift+Enter: 줄바꿈, Ctrl+V: 캡처 첨부)";
}

export type ComposerMenuState = {
  canCut: boolean;
  canCopy: boolean;
  canSelectAll: boolean;
  canClear: boolean;
};

/** Right-click edit menu. Paste stays available so an empty box can still receive text. */
export function composerMenuState(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): ComposerMenuState {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const hasSelection = value.length > 0 && end > start;
  return {
    canCut: hasSelection,
    canCopy: hasSelection,
    canSelectAll: value.length > 0,
    canClear: value.length > 0,
  };
}

/** Replace the current selection. `removed` is what cut or overwrite took out. */
export function spliceComposerText(opts: {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  insert: string;
}): { value: string; cursor: number; removed: string } {
  const start = Math.max(0, Math.min(opts.selectionStart, opts.selectionEnd, opts.value.length));
  const end = Math.max(start, Math.min(Math.max(opts.selectionStart, opts.selectionEnd), opts.value.length));
  const removed = opts.value.slice(start, end);
  const value = opts.value.slice(0, start) + opts.insert + opts.value.slice(end);
  return { value, cursor: start + opts.insert.length, removed };
}
