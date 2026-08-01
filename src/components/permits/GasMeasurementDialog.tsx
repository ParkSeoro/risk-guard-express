/**
 * Collect required gas readings before closure approval.
 * Saves via save_permit_gas_readings RPC (gas keys only).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  GAS_FIELD_LABEL,
  type GasFieldKey,
  pickGasReadings,
  requiredGasFieldsForKinds,
  validatePermitGasForClosure,
} from '@/lib/permitGasValidation';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permitId: string;
  permitKinds: unknown;
  initialFormData?: Record<string, unknown> | null;
  /** After successful save (and optional continue). */
  onSaved: (formData: Record<string, unknown>) => void | Promise<void>;
  /** Primary button continues into closure approve. */
  continueLabel?: string;
};

const PLACEHOLDER: Partial<Record<GasFieldKey, string>> = {
  gas_o2: '%',
  gas_co2: '%',
  gas_h2s: 'ppm',
  gas_co: 'ppm',
  gas_hc: '%',
  gas_time: '예: 14:30',
  gas_measurer: '성명',
};

export default function GasMeasurementDialog({
  open,
  onOpenChange,
  permitId,
  permitKinds,
  initialFormData,
  onSaved,
  continueLabel = '저장 후 완료 확인',
}: Props) {
  const required = requiredGasFieldsForKinds(permitKinds);
  const [values, setValues] = useState<Partial<Record<GasFieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(pickGasReadings(initialFormData || {}));
    setError(null);
  }, [open, initialFormData]);

  const setField = (k: GasFieldKey, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
  };

  const save = async () => {
    const check = validatePermitGasForClosure(values as Record<string, unknown>, permitKinds);
    if (!check.ok) {
      setError(`미입력: ${check.missingLabels.join(', ')}`);
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      for (const k of required) {
        payload[k] = String(values[k] ?? '').trim();
      }
      const { data, error: rpcError } = await (supabase as any).rpc('save_permit_gas_readings', {
        _permit_id: permitId,
        _readings: payload,
      });
      if (rpcError) throw rpcError;
      if (data?.error) throw new Error(data.error);
      const merged = { ...(initialFormData || {}), ...payload };
      await onSaved(merged);
      return true;
    } catch (e: any) {
      setError(e?.message || '저장 실패');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>가스농도 측정 입력</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          작업 완료 확인 전에 아래 측정값을 모두 입력해야 합니다.
        </p>
        <div className="grid gap-3 py-1">
          {required.map((k) => (
            <div key={k} className="space-y-1">
              <Label className="text-xs">{GAS_FIELD_LABEL[k]}</Label>
              <Input
                value={values[k] || ''}
                placeholder={PLACEHOLDER[k]}
                onChange={(e) => setField(k, e.target.value)}
              />
            </div>
          ))}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={async () => {
              const ok = await save();
              if (ok) onOpenChange(false);
            }}
          >
            {saving ? '저장 중…' : continueLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
