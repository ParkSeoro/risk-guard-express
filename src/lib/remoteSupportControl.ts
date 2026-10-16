import type { RemoteControlEvent } from "@/lib/remoteSupport";

export type NormPoint = { x: number; y: number };

export type VideoContentBox = {
  /** Offset of the letterboxed content inside the video element. */
  offsetX: number;
  offsetY: number;
  contentW: number;
  contentH: number;
};

/** object-contain content rectangle inside a video element's client box. */
export function videoObjectContainBox(video: HTMLVideoElement): VideoContentBox | null {
  const elW = video.clientWidth;
  const elH = video.clientHeight;
  const mediaW = video.videoWidth;
  const mediaH = video.videoHeight;
  if (!elW || !elH || !mediaW || !mediaH) return null;
  const scale = Math.min(elW / mediaW, elH / mediaH);
  const contentW = mediaW * scale;
  const contentH = mediaH * scale;
  return {
    offsetX: (elW - contentW) / 2,
    offsetY: (elH - contentH) / 2,
    contentW,
    contentH,
  };
}

/**
 * Map a pointer event on a letterboxed `<video object-fit:contain>` to
 * normalized 0..1 coords over the media content. Returns null if outside.
 */
export function clientPointToNormalized(
  video: HTMLVideoElement,
  clientX: number,
  clientY: number,
): NormPoint | null {
  const box = videoObjectContainBox(video);
  if (!box || box.contentW <= 0 || box.contentH <= 0) return null;
  const rect = video.getBoundingClientRect();
  const localX = clientX - rect.left - box.offsetX;
  const localY = clientY - rect.top - box.offsetY;
  if (localX < 0 || localY < 0 || localX > box.contentW || localY > box.contentH) return null;
  return {
    x: Math.min(1, Math.max(0, localX / box.contentW)),
    y: Math.min(1, Math.max(0, localY / box.contentH)),
  };
}

export function normalizedToViewport(point: NormPoint): { x: number; y: number } {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  return {
    x: Math.min(w - 1, Math.max(0, point.x * w)),
    y: Math.min(h - 1, Math.max(0, point.y * h)),
  };
}

/** Only in-app SafeNex routes — never leave the SPA shell. */
export function isSafeNexAppPath(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  const p = path.trim();
  if (!p.startsWith("/")) return false;
  if (p.startsWith("//")) return false;
  if (/^[a-z]+:/i.test(p)) return false;
  return (
    p.startsWith("/app/admin") ||
    p.startsWith("/app/worker") ||
    p === "/app" ||
    p.startsWith("/app?") ||
    p.startsWith("/manual") ||
    p.startsWith("/settings") ||
    p.startsWith("/m/") ||
    p === "/m"
  );
}

function targetAt(nx: number, ny: number): Element | null {
  const { x, y } = normalizedToViewport({ x: nx, y: ny });
  return document.elementFromPoint(x, y);
}

function clickableTarget(el: Element | null): Element | null {
  if (!el) return null;
  const interactive = el.closest(
    'a,button,input,textarea,select,label,[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="checkbox"],[role="radio"],summary,[data-remote-click]',
  );
  return interactive || el;
}

export function applyRemoteClick(event: Extract<RemoteControlEvent, { kind: "click" }>): boolean {
  const { x, y } = normalizedToViewport({ x: event.x, y: event.y });
  const raw = document.elementFromPoint(x, y);
  const el = clickableTarget(raw);
  if (!el) return false;

  const common: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: event.button ?? 0,
    buttons: 1,
    detail: event.detail ?? 1,
    ctrlKey: !!event.ctrlKey,
    shiftKey: !!event.shiftKey,
    altKey: !!event.altKey,
    metaKey: !!event.metaKey,
  };

  // Focus first so inputs / selects receive the interaction.
  if (el instanceof HTMLElement) {
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }

  el.dispatchEvent(new MouseEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mousedown", common));
  el.dispatchEvent(new MouseEvent("pointerup", { ...common, pointerId: 1, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mouseup", common));
  el.dispatchEvent(new MouseEvent("click", common));
  if ((event.detail ?? 1) >= 2) {
    el.dispatchEvent(new MouseEvent("dblclick", { ...common, detail: 2 }));
  }
  return true;
}

export function applyRemoteScroll(event: Extract<RemoteControlEvent, { kind: "scroll" }>): boolean {
  const { x, y } = normalizedToViewport({ x: event.x, y: event.y });
  const el = targetAt(event.x, event.y) || document.scrollingElement || document.documentElement;
  if (!el) return false;

  // Prefer the nearest scrollable ancestor.
  let node: Element | null = el instanceof Element ? el : null;
  let scrolled = false;
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const oy = style.overflowY;
    const ox = style.overflowX;
    const canY = (oy === "auto" || oy === "scroll" || oy === "overlay") && node.scrollHeight > node.clientHeight;
    const canX = (ox === "auto" || ox === "scroll" || ox === "overlay") && node.scrollWidth > node.clientWidth;
    if (canY || canX) {
      node.scrollBy({ left: event.deltaX, top: event.deltaY, behavior: "auto" });
      scrolled = true;
      break;
    }
    node = node.parentElement;
  }
  if (!scrolled) {
    window.scrollBy({ left: event.deltaX, top: event.deltaY, behavior: "auto" });
  }

  const target = el instanceof Element ? el : document.body;
  target.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    }),
  );
  return true;
}

export function applyRemoteKey(event: Extract<RemoteControlEvent, { kind: "key" }>): boolean {
  const active = document.activeElement;
  const target: EventTarget = active && active !== document.body ? active : document;
  const init: KeyboardEventInit = {
    bubbles: true,
    cancelable: true,
    key: event.key,
    code: event.code,
    ctrlKey: !!event.ctrlKey,
    shiftKey: !!event.shiftKey,
    altKey: !!event.altKey,
    metaKey: !!event.metaKey,
  };
  target.dispatchEvent(new KeyboardEvent(event.type, init));

  // For printable keys into inputs when browsers ignore synthetic keypress.
  if (
    event.type === "keydown" &&
    (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
  ) {
    const field = active as HTMLInputElement | HTMLTextAreaElement;
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? field.value.length;
      const next = field.value.slice(0, start) + event.key + field.value.slice(end);
      const proto = field instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc?.set?.call(field, next);
      const caret = start + 1;
      try {
        field.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
      field.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (event.key === "Backspace") {
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? field.value.length;
      let next = field.value;
      let caret = start;
      if (start !== end) {
        next = field.value.slice(0, start) + field.value.slice(end);
        caret = start;
      } else if (start > 0) {
        next = field.value.slice(0, start - 1) + field.value.slice(end);
        caret = start - 1;
      }
      const proto = field instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc?.set?.call(field, next);
      try {
        field.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  return true;
}
