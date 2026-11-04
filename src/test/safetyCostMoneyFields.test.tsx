import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SafetyCostMoneyFields } from '@/components/safety-cost/SafetyCostMoneyFields';

describe('SafetyCostMoneyFields', () => {
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

  function mount(node: ReactNode) {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(node);
    });
  }

  it('shows commas on the receipt amounts and Korean under the total', () => {
    mount(
      <SafetyCostMoneyFields
        unitPrice="220000"
        supplyAmount="1100000"
        vatAmount="110000"
        amount="1210000"
        onChange={() => {}}
      />,
    );
    expect((document.getElementById('safety-cost-unit-price') as HTMLInputElement).value).toBe('220,000');
    expect((document.getElementById('safety-cost-supply') as HTMLInputElement).value).toBe('1,100,000');
    expect((document.getElementById('safety-cost-vat') as HTMLInputElement).value).toBe('110,000');
    expect((document.getElementById('safety-cost-amount') as HTMLInputElement).value).toBe('1,210,000');
    expect(el?.textContent).toContain('백이십일만 원');
  });

  it('hides the Korean line when the amount is empty', () => {
    mount(
      <SafetyCostMoneyFields
        unitPrice=""
        supplyAmount=""
        vatAmount=""
        amount=""
        onChange={() => {}}
      />,
    );
    expect(el?.textContent).not.toContain('원');
  });

  it('keeps digits in state and shows commas after typing', () => {
    function Harness() {
      const [unitPrice, setUnitPrice] = useState('');
      const [amount, setAmount] = useState('');
      return (
        <SafetyCostMoneyFields
          unitPrice={unitPrice}
          supplyAmount=""
          vatAmount=""
          amount={amount}
          onChange={(field, raw) => {
            if (field === 'unit_price') {
              setUnitPrice(raw);
              setAmount(raw);
            }
          }}
        />
      );
    }
    mount(<Harness />);
    const input = document.getElementById('safety-cost-unit-price') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input, '1,210,000');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('1,210,000');
    expect((document.getElementById('safety-cost-amount') as HTMLInputElement).value).toBe('1,210,000');
    expect(el?.textContent).toContain('백이십일만 원');
  });
});
