import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { aggregatePpeStock, normalizePpeItemKey, type PpeMovementType } from '@/lib/safetyCostPpeStock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Package, Plus } from 'lucide-react';

type Props = {
  projectId: string;
  companyId: string;
  constructionId: string;
  userId?: string;
};

export function PpeStockPanel({ projectId, companyId, constructionId, userId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [skus, setSkus] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [itemName, setItemName] = useState('');
  const [specification, setSpecification] = useState('');
  const [maker, setMaker] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [movementType, setMovementType] = useState<PpeMovementType>('adjust');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: skuRows }, { data: movRows }] = await Promise.all([
      supabase.from('safety_cost_ppe_skus' as any).select('*').eq('construction_id', constructionId).order('item_name'),
      supabase.from('safety_cost_ppe_stock_movements' as any)
        .select('*')
        .eq('construction_id', constructionId)
        .eq('is_deleted', false)
        .order('movement_date', { ascending: false })
        .limit(200),
    ]);
    setSkus((skuRows as any[]) || []);
    setMovements((movRows as any[]) || []);
    setLoading(false);
  }, [constructionId]);

  useEffect(() => { load(); }, [load]);

  const balances = useMemo(
    () => aggregatePpeStock(skus, movements.map((m) => ({
      sku_id: m.sku_id,
      movement_type: m.movement_type,
      quantity: Number(m.quantity),
      is_deleted: m.is_deleted,
    }))),
    [skus, movements],
  );

  async function upsertSku() {
    const item_key = normalizePpeItemKey({ item_name: itemName, specification, maker });
    const { data: existing } = await supabase
      .from('safety_cost_ppe_skus' as any)
      .select('id')
      .eq('construction_id', constructionId)
      .eq('item_key', item_key)
      .maybeSingle();
    if (existing) return (existing as any).id as string;
    const { data, error } = await supabase.from('safety_cost_ppe_skus' as any).insert({
      project_id: projectId,
      company_id: companyId,
      construction_id: constructionId,
      item_key,
      item_name: itemName.trim(),
      specification: specification.trim(),
      maker: maker.trim(),
      unit: '개',
    }).select('id').single();
    if (error) throw error;
    return (data as any).id as string;
  }

  async function submitAdjust() {
    if (!itemName.trim() || Number(quantity) <= 0) {
      toast({ title: '품명과 수량을 입력하세요.', variant: 'destructive' });
      return;
    }
    try {
      const skuId = await upsertSku();
      const { error } = await supabase.from('safety_cost_ppe_stock_movements' as any).insert({
        project_id: projectId,
        company_id: companyId,
        construction_id: constructionId,
        sku_id: skuId,
        movement_type: movementType,
        quantity: Number(quantity),
        movement_date: new Date().toISOString().slice(0, 10),
        source_type: 'manual',
        note: note || (movementType === 'adjust' ? '실사 조정' : ''),
        created_by: userId || null,
      });
      if (error) throw error;
      toast({ title: '수불 반영됨' });
      setAdjustOpen(false);
      setItemName('');
      setQuantity('1');
      setNote('');
      load();
    } catch (e: any) {
      toast({ title: '수불 저장 실패', description: e.message, variant: 'destructive' });
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground py-6">수불대장 로딩 중…</div>;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Package className="h-4 w-4" /> 보호구 수불대장 (재고)
            </CardTitle>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setAdjustOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> 수기 입출고/실사
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            영수증(비목 3) 등록 시 자동 입고됩니다. 지급대장 서명 시 출고됩니다. 구매 ≠ 지급입니다.
          </p>
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>품명</TableHead>
                  <TableHead>규격/메이커</TableHead>
                  <TableHead>입고</TableHead>
                  <TableHead>출고</TableHead>
                  <TableHead>잔량</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((b) => (
                  <TableRow key={b.sku_id}>
                    <TableCell className="text-sm font-medium">{b.item_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{[b.specification, b.maker].filter(Boolean).join(' · ') || '—'}</TableCell>
                    <TableCell className="text-xs">{b.qtyIn}</TableCell>
                    <TableCell className="text-xs">{b.qtyOut}</TableCell>
                    <TableCell>
                      <Badge variant={b.balance < 0 ? 'destructive' : 'secondary'}>{b.balance} {b.unit}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {balances.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground text-sm">
                      재고 내역이 없습니다. 보호구 항목 등록 또는 승인본 이관 후 표시됩니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">최근 수불 이동</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-auto rounded-md border max-h-64">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>일자</TableHead>
                  <TableHead>유형</TableHead>
                  <TableHead>품명</TableHead>
                  <TableHead>수량</TableHead>
                  <TableHead>출처</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.slice(0, 40).map((m) => {
                  const sku = skus.find((s) => s.id === m.sku_id);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs">{m.movement_date}</TableCell>
                      <TableCell><Badge variant="outline">{m.movement_type}</Badge></TableCell>
                      <TableCell className="text-sm">{sku?.item_name || '—'}</TableCell>
                      <TableCell className="text-xs">{m.quantity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.source_type}{m.note ? ` · ${m.note}` : ''}</TableCell>
                    </TableRow>
                  );
                })}
                {movements.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground text-sm">이동 없음</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>수기 입출고 / 실사</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1"><Label>유형</Label>
              <Select value={movementType} onValueChange={(v) => setMovementType(v as PpeMovementType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">입고</SelectItem>
                  <SelectItem value="out">출고</SelectItem>
                  <SelectItem value="return">반납(입고)</SelectItem>
                  <SelectItem value="dispose">폐기</SelectItem>
                  <SelectItem value="adjust">실사 증가(+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>품명</Label><Input value={itemName} onChange={(e) => setItemName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>규격</Label><Input value={specification} onChange={(e) => setSpecification(e.target.value)} /></div>
              <div className="space-y-1"><Label>메이커</Label><Input value={maker} onChange={(e) => setMaker(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>수량</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
            <div className="space-y-1"><Label>비고</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="실사 조정 사유 등" /></div>
          </div>
          <DialogFooter><Button onClick={submitAdjust}>저장</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PpeStockPanel;
