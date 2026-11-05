import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import SafetyCostPrintDialog from '@/components/safety-cost/SafetyCostPrintDialog';

describe('SafetyCostPrintDialog', () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
  });

  function mount(legacy: boolean) {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <SafetyCostPrintDialog open onOpenChange={() => {}} reportId="rep-1" legacy={legacy} />,
      );
    });
  }

  it('starts with the default bundle and locks extra sections on a legacy month', () => {
    mount(false);
    expect(document.body.textContent).toContain('사진·세금계산서 대지');
    expect(document.body.textContent).toContain('보호구 지급대장');
    const stock = [...document.querySelectorAll('label')].find((node) => node.textContent?.includes('보호구 수불'));
    expect(stock?.querySelector('button')?.getAttribute('data-state')).toBe('unchecked');
    const originals = [...document.querySelectorAll('label')].find((node) => node.textContent?.includes('원본 전체'));
    expect(originals?.querySelector('button')?.getAttribute('data-state')).toBe('unchecked');

    act(() => {
      root?.unmount();
    });
    mount(true);
    expect(document.body.textContent).toContain('이관 월은 표지, 총괄, 항목 금액만');
    const photos = [...document.querySelectorAll('label')].find((node) => node.textContent?.includes('사진·세금계산서'));
    expect(photos?.querySelector('button')?.disabled).toBe(true);
  });

  it('keeps submitted reports locked and selects the report from the address', () => {
    const src = readFileSync('src/pages/SafetyCost.tsx', 'utf8');
    expect(src).toContain('isSafetyCostReportLocked');
    expect(src).toContain('reportLocked');
    expect(src).toContain("searchParams.get('reportId')");
    expect(src).not.toContain('월별 집계표');
    expect(src).not.toContain('해당 없거나 미작성');
  });
});
