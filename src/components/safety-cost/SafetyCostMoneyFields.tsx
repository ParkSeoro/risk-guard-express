import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoneyInput, formatWonKorean } from '@/lib/safetyCost';

type MoneyField = 'unit_price' | 'supply_amount' | 'vat_amount';

const keepMoneyCaret = (el: HTMLInputElement, digitsBefore: number, formatted: string) => {
  let seen = 0;
  let pos = formatted.length;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) seen += 1;
    if (seen >= digitsBefore) {
      pos = i + 1;
      break;
    }
  }
  requestAnimationFrame(() => el.setSelectionRange(pos, pos));
};

export function SafetyCostMoneyFields({
  unitPrice,
  supplyAmount,
  vatAmount,
  amount,
  onChange,
}: {
  unitPrice: string;
  supplyAmount: string;
  vatAmount: string;
  amount: string;
  onChange: (field: MoneyField, rawDigits: string) => void;
}) {
  function onMoneyInput(field: MoneyField, el: HTMLInputElement) {
    const caret = el.selectionStart ?? el.value.length;
    const digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length;
    const raw = el.value.replace(/\D/g, '');
    onChange(field, raw);
    keepMoneyCaret(el, digitsBefore, formatMoneyInput(raw));
  }

  const amountWords = formatWonKorean(amount);

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="safety-cost-unit-price">단가</Label>
        <Input id="safety-cost-unit-price" inputMode="numeric" autoComplete="off" className="tabular-nums" value={formatMoneyInput(unitPrice)} onChange={(e) => onMoneyInput('unit_price', e.target)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="safety-cost-supply">공급가액</Label>
        <Input id="safety-cost-supply" inputMode="numeric" autoComplete="off" className="tabular-nums" value={formatMoneyInput(supplyAmount)} onChange={(e) => onMoneyInput('supply_amount', e.target)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="safety-cost-vat">부가세</Label>
        <Input id="safety-cost-vat" inputMode="numeric" autoComplete="off" className="tabular-nums" value={formatMoneyInput(vatAmount)} onChange={(e) => onMoneyInput('vat_amount', e.target)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="safety-cost-amount">금액</Label>
        <Input id="safety-cost-amount" inputMode="numeric" readOnly aria-describedby={amountWords ? "safety-cost-amount-words" : undefined} className="bg-muted/40 tabular-nums" value={formatMoneyInput(amount)} />
        {amountWords ? <p id="safety-cost-amount-words" className="text-xs text-muted-foreground">{amountWords}</p> : null}
      </div>
    </>
  );
}
