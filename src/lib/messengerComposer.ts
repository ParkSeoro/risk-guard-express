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
