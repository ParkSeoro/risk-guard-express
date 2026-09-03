import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, type ComponentProps } from 'react';

const fetchMock = vi.fn();

vi.mock('@/lib/assessmentAuthorQuery', () => ({
  fetchAssessmentAuthorCandidates: (...args: unknown[]) => fetchMock(...args),
}));

import AssessmentAuthorPicker from '@/components/assessment-runs/AssessmentAuthorPicker';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AssessmentAuthorPicker loading', () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
    fetchMock.mockReset();
  });

  function renderPicker(props: Partial<ComponentProps<typeof AssessmentAuthorPicker>> = {}) {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <AssessmentAuthorPicker
          projectId="p1"
          value=""
          onChange={() => {}}
          {...props}
        />,
      );
    });
  }

  it('does not stay on 불러오는 중 when the company list is empty', async () => {
    renderPicker({ companyIds: [] });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(el?.textContent).not.toMatch(/불러오는 중/);
    expect(el?.textContent).toMatch(/등록된 관리감독자가 없습니다/);
  });

  it('stays loading while company scope is pending, then clears if fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    renderPicker({ companyFilterPending: true, companyIds: [] });
    expect(el?.textContent).toMatch(/불러오는 중/);
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      root!.render(
        <AssessmentAuthorPicker
          projectId="p1"
          value=""
          onChange={() => {}}
          companyIds={['c1']}
          companyFilterPending={false}
        />,
      );
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el?.textContent).not.toMatch(/불러오는 중/);
    expect(el?.textContent).toMatch(/등록된 관리감독자가 없습니다/);
  });

  it('clears 불러오는 중 after a successful fetch', async () => {
    fetchMock.mockResolvedValueOnce([
      { user_id: 'u1', display_name: '김감독', company_id: 'c1', company_name: '정원' },
    ]);
    renderPicker({ companyIds: ['c1'], value: 'u1' });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el?.textContent).not.toMatch(/불러오는 중/);
    expect(el?.textContent).toMatch(/김감독/);
  });
});
