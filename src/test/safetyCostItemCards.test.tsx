import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SafetyCostItemCards } from '@/components/safety-cost/SafetyCostItemCards';

describe('SafetyCostItemCards', () => {
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

  it('shows 임금, daily photo/statement counts, and month-end tax waiting copy', () => {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <SafetyCostItemCards
          items={[
            {
              id: 'wage',
              item_name: '안전관리자 급여',
              category_code: '1',
              category_name: '안전·보건관리자 임금 등',
              classification_status: 'usable',
              ai_reason: '임금 비목으로 분류했습니다.',
              amount: 2_000_000,
              supplier_name: '현장',
              transaction_date: '2026-09-01',
            },
            {
              id: 'ppe',
              item_name: '안전모',
              category_code: '3',
              category_name: '보호구 등',
              classification_status: 'usable',
              ai_reason: '보호구 사용 가능',
              amount: 50_000,
              supplier_name: '안전상사',
              transaction_date: '2026-09-02',
            },
          ]}
          evidence={[
            { id: 'tx1', item_id: 'ppe', evidence_kind: 'transaction', file_name: '명세1.jpg' },
            { id: 'tx2', item_id: 'ppe', evidence_kind: 'transaction', file_name: '명세2.jpg' },
          ]}
          reportLocked={false}
          isLegacyImport={false}
          itemSearch=""
          onItemSearch={vi.fn()}
          displayDate={(it) => String(it.transaction_date || '')}
          datePriorityLabel={() => '거래날짜'}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onLegal={vi.fn()}
          onOpenPpe={vi.fn()}
          onOpenPack={vi.fn()}
          onUpload={vi.fn()}
        />,
      );
    });

    expect(el.textContent).toContain('임금');
    expect(el.textContent).toContain('보호구');
    expect(el.textContent).toContain('사용 가능');
    expect(el.textContent).toContain('월말 · 이 비목 대기');
    expect(el.textContent).toContain('거래명세서 2장');
    expect(el.textContent).toContain('명세 추가');
    expect(el.textContent).toContain('촬영');
    expect(el.textContent).toContain('수기 입력');
    expect(el.textContent).toMatch(/수정/);
    expect(el.querySelector('input[capture="environment"]')).toBeTruthy();
  });
});
