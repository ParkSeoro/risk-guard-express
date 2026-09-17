import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import DigPermitForm from '@/components/permits/DigPermitForm';

async function renderPermit(permitType: 'hot_work' | 'confined_space' | 'general' | 'excavation') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <DigPermitForm
        permitType={permitType}
        data={{ gas_o2: '20.9', gas_o2_2: '20.8' }}
        signatures={{}}
        readOnly
        printMode
      />,
    );
  });
  return { host, root };
}

describe('permit gas extra rows', () => {
  it('hot work print keeps 측정결과 and adds 2~4회 rows', async () => {
    const { host, root } = await renderPermit('hot_work');
    const gas = host.querySelector('#permit-gas-fields');
    expect(gas?.textContent).toContain('가스농도 측정결과');
    expect(gas?.textContent).toContain('측정결과');
    expect(gas?.textContent).toContain('2회');
    expect(gas?.textContent).toContain('3회');
    expect(gas?.textContent).toContain('4회');
    expect(gas?.textContent).toContain('20.9');
    expect(gas?.textContent).toContain('20.8');
    expect(host.textContent).toContain('화기작업허가서');
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('confined space print keeps 측정결과 and adds 2~4회 rows', async () => {
    const { host, root } = await renderPermit('confined_space');
    const gas = host.querySelector('#permit-gas-fields');
    expect(gas?.textContent).toContain('가스농도 측정결과 확인');
    expect(gas?.textContent).toContain('측정결과');
    expect(gas?.textContent).toContain('2회');
    expect(gas?.textContent).toContain('3회');
    expect(gas?.textContent).toContain('4회');
    expect(host.textContent).toContain('밀폐공간 작업허가서');
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('general and excavation print stay without 2~4회 gas rows', async () => {
    const general = await renderPermit('general');
    expect(general.host.querySelector('#permit-gas-fields')?.textContent).toContain('가스농도측정');
    expect(general.host.textContent).not.toContain('2회');
    expect(general.host.textContent).not.toContain('3회');
    expect(general.host.textContent).not.toContain('4회');
    await act(async () => { general.root.unmount(); });
    general.host.remove();

    const excavation = await renderPermit('excavation');
    expect(excavation.host.querySelector('#permit-gas-fields')).toBeNull();
    expect(excavation.host.textContent).not.toContain('2회');
    await act(async () => { excavation.root.unmount(); });
    excavation.host.remove();
  });
});
