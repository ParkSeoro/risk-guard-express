/** 보호구 수불/재고 SSOT helpers */

export type PpeMovementType = 'in' | 'out' | 'adjust' | 'return' | 'dispose';

export type PpeStockMovement = {
  id?: string;
  sku_id: string;
  movement_type: PpeMovementType;
  quantity: number;
  movement_date?: string;
  item_name?: string;
  specification?: string;
  maker?: string;
  unit?: string;
  is_deleted?: boolean;
};

export type PpeSkuBalance = {
  sku_id: string;
  item_key: string;
  item_name: string;
  specification: string;
  maker: string;
  unit: string;
  qtyIn: number;
  qtyOut: number;
  qtyAdjust: number;
  balance: number;
};

/** 품명·규격·메이커로 SKU 키 정규화 */
export function normalizePpeItemKey(input: {
  item_name?: string;
  specification?: string;
  maker?: string;
}) {
  const norm = (s: string) =>
    s
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[()[\]{}]/g, '')
      .toLowerCase();
  const name = norm(String(input.item_name || ''));
  const spec = norm(String(input.specification || ''));
  const maker = norm(String(input.maker || ''));
  return [name, spec, maker].filter(Boolean).join('|') || 'unknown';
}

export function signedQuantity(type: PpeMovementType, quantity: number) {
  const q = Math.abs(Number(quantity) || 0);
  if (type === 'in' || type === 'return') return q;
  if (type === 'out' || type === 'dispose') return -q;
  // adjust: quantity는 절대값, 부호는 note/별도 필드로 처리하지 않고
  // movement_type adjust + quantity 양수 = 증가로 보고, 감소는 dispose 권장.
  // 실무 단순화: adjust는 양수=증가, 같은 타입으로 감소 기록 시 호출측에서 out/dispose 사용.
  return q;
}

export function aggregatePpeStock(
  skus: Array<{
    id: string;
    item_key: string;
    item_name: string;
    specification?: string;
    maker?: string;
    unit?: string;
  }>,
  movements: PpeStockMovement[],
): PpeSkuBalance[] {
  const bySku = new Map<string, PpeSkuBalance>();
  for (const s of skus) {
    bySku.set(s.id, {
      sku_id: s.id,
      item_key: s.item_key,
      item_name: s.item_name,
      specification: s.specification || '',
      maker: s.maker || '',
      unit: s.unit || '개',
      qtyIn: 0,
      qtyOut: 0,
      qtyAdjust: 0,
      balance: 0,
    });
  }

  for (const m of movements) {
    if (m.is_deleted) continue;
    const row = bySku.get(m.sku_id);
    if (!row) continue;
    const q = Math.abs(Number(m.quantity) || 0);
    if (!q) continue;
    if (m.movement_type === 'in' || m.movement_type === 'return') {
      row.qtyIn += q;
      row.balance += q;
    } else if (m.movement_type === 'out' || m.movement_type === 'dispose') {
      row.qtyOut += q;
      row.balance -= q;
    } else if (m.movement_type === 'adjust') {
      row.qtyAdjust += q;
      row.balance += q;
    }
  }

  return [...bySku.values()].sort((a, b) => a.item_name.localeCompare(b.item_name, 'ko'));
}

export function canIssueFromStock(balance: number, issueQty: number) {
  const q = Math.abs(Number(issueQty) || 0);
  return {
    ok: balance >= q,
    balance,
    shortfall: Math.max(0, q - balance),
  };
}

export type PpeIssueChannel = 'manual' | 'app' | 'legacy';

export function planPpeIssue(opts: {
  quantity: number;
  stockBalance: number;
  signatureData?: string | null;
  channel?: PpeIssueChannel;
}) {
  const qty = Math.abs(Number(opts.quantity) || 0);
  const stock = canIssueFromStock(opts.stockBalance, qty);
  const signature = String(opts.signatureData || '').trim();
  const channel: PpeIssueChannel = opts.channel || (signature ? 'manual' : 'app');
  const confirmed = channel === 'legacy' || Boolean(signature);
  return {
    ok: qty > 0 && stock.ok,
    quantity: qty,
    shortfall: stock.shortfall,
    receipt_status: confirmed ? 'confirmed' : 'pending',
    receipt_channel: channel,
    writesStockOut: confirmed,
  };
}

export function planPpeConfirm(entry: {
  receipt_status?: string | null;
  signature_data?: string | null;
  stock_movement_id?: string | null;
  is_deleted?: boolean | null;
}) {
  if (entry.is_deleted) return { ok: false, alreadyConfirmed: false, writesStockOut: false, reason: 'deleted' as const };
  const signed = Boolean(String(entry.signature_data || '').trim()) || entry.receipt_status === 'confirmed';
  if (signed) {
    return {
      ok: true,
      alreadyConfirmed: true,
      writesStockOut: !entry.stock_movement_id,
      reason: 'already_confirmed' as const,
    };
  }
  return { ok: true, alreadyConfirmed: false, writesStockOut: true, reason: 'confirm' as const };
}

/** 거래 항목이 보호구 입고 대상인지 */
export function isPpeInboundItem(item: { category_code?: string | null; quantity?: number | string | null; item_name?: string }) {
  if (String(item.category_code || '') !== '3') return false;
  return Number(item.quantity || 0) > 0 && Boolean(String(item.item_name || '').trim());
}
