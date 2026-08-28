import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ResponsiveSignaturePad, { type ResponsiveSignaturePadHandle } from '@/components/ResponsiveSignaturePad';
import { ADMIN_PROJECT_ROLES } from '@/lib/permissions';
import { ClipboardList, Plus, Printer, Trash2 } from 'lucide-react';

type Ledger = {
  id: string;
  site_label: string;
  safety_manager_name: string;
  item_columns: string[];
};

type Entry = {
  id: string;
  issued_at: string;
  worker_name: string;
  item_name: string;
  quantity: number;
  signature_data: string;
  signed_at: string | null;
  stock_movement_id?: string | null;
  receipt_status?: string;
  receipt_channel?: string;
  specification?: string;
  maker?: string;
};

type Recipient = {
  key: string;
  name: string;
  role: 'worker' | 'manager';
  workerId?: string | null;
  userId?: string | null;
};

type Props = {
  projectId: string;
  companyId: string;
  constructionId: string;
  reportId: string;
  constructionName?: string;
  defaultItemNames?: string[];
  userId?: string;
  onChanged?: () => void;
};

export function PpeLedgerPanel({
  projectId, companyId, constructionId, reportId,
  constructionName, defaultItemNames, userId, onChanged,
}: Props) {
  const { toast } = useToast();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteLabel, setSiteLabel] = useState(constructionName || '');
  const [managerName, setManagerName] = useState('');
  const [itemColumnsText, setItemColumnsText] = useState(
    (defaultItemNames?.length ? defaultItemNames : ['안전모', '안전화', '안전조끼']).join(', '),
  );
  const [signOpen, setSignOpen] = useState(false);
  const [recipientKey, setRecipientKey] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [issuedAt, setIssuedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [itemName, setItemName] = useState('');
  const [specification, setSpecification] = useState('');
  const [maker, setMaker] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const sigRef = useRef<ResponsiveSignaturePadHandle | null>(null);

  const itemColumns = useMemo(
    () => itemColumnsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    [itemColumnsText],
  );

  const signedCount = entries.filter((e) => e.signature_data || e.receipt_status === 'confirmed').length;
  const selectedRecipient = recipients.find((r) => r.key === recipientKey);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: led } = await supabase
      .from('safety_cost_ppe_ledgers' as any)
      .select('*')
      .eq('report_id', reportId)
      .eq('is_deleted', false)
      .maybeSingle();
    if (led) {
      const row = led as any;
      const cols = Array.isArray(row.item_columns) ? row.item_columns.map(String) : [];
      setLedger({
        id: row.id,
        site_label: row.site_label || '',
        safety_manager_name: row.safety_manager_name || '',
        item_columns: cols,
      });
      setSiteLabel(row.site_label || constructionName || '');
      setManagerName(row.safety_manager_name || '');
      if (cols.length) setItemColumnsText(cols.join(', '));
      const { data: ents } = await supabase
        .from('safety_cost_ppe_ledger_entries' as any)
        .select('*')
        .eq('ledger_id', row.id)
        .eq('is_deleted', false)
        .order('issued_at', { ascending: true })
        .order('sort_order', { ascending: true });
      setEntries(((ents as any[]) || []).map((e) => ({
        id: e.id,
        issued_at: e.issued_at,
        worker_name: e.worker_name,
        item_name: e.item_name,
        quantity: Number(e.quantity || 1),
        signature_data: e.signature_data || '',
        signed_at: e.signed_at,
        stock_movement_id: e.stock_movement_id,
        receipt_status: e.receipt_status,
        receipt_channel: e.receipt_channel,
        specification: e.specification,
        maker: e.maker,
      })));
    } else {
      setLedger(null);
      setEntries([]);
    }
    setLoading(false);
  }, [reportId, constructionName]);

  const loadRecipients = useCallback(async () => {
    const [{ data: workers }, { data: members }] = await Promise.all([
      supabase.from('workers').select('id, name, phone, job_type').eq('project_id', projectId).eq('is_active', true).order('name'),
      supabase.from('project_members').select('user_id, role_new, company_id').eq('project_id', projectId).eq('company_id', companyId),
    ]);
    const list: Recipient[] = ((workers as any[]) || []).map((w) => ({
      key: `w:${w.id}`,
      name: w.name,
      role: 'worker' as const,
      workerId: w.id,
    }));
    const admins = ((members as any[]) || []).filter((m) => m.user_id && ADMIN_PROJECT_ROLES.includes(m.role_new));
    if (admins.length) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, display_name').in('user_id', admins.map((m: any) => m.user_id));
      for (const p of (profiles as any[]) || []) {
        const role = admins.find((m: any) => m.user_id === p.user_id)?.role_new;
        list.push({
          key: `u:${p.user_id}`,
          name: `${p.display_name || '관리자'} (${role === 'safety_manager' ? '안전관리자' : role === 'site_manager' ? '현장대리인' : '관리감독자'})`,
          role: 'manager',
          userId: p.user_id,
        });
      }
    }
    setRecipients(list);
  }, [projectId, companyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRecipients(); }, [loadRecipients]);

  async function ensureLedger(): Promise<string | null> {
    if (ledger?.id) {
      await supabase.from('safety_cost_ppe_ledgers' as any).update({
        site_label: siteLabel.trim(),
        safety_manager_name: managerName.trim(),
        item_columns: itemColumns,
      }).eq('id', ledger.id);
      return ledger.id;
    }
    const { data, error } = await supabase.from('safety_cost_ppe_ledgers' as any).insert({
      project_id: projectId,
      company_id: companyId,
      construction_id: constructionId,
      report_id: reportId,
      site_label: siteLabel.trim() || constructionName || '',
      safety_manager_name: managerName.trim(),
      item_columns: itemColumns,
      created_by: userId || null,
    }).select('id').single();
    if (error) {
      toast({ title: '지급대장 생성 실패', description: error.message, variant: 'destructive' });
      return null;
    }
    await load();
    onChanged?.();
    return (data as any).id as string;
  }

  async function saveHeader() {
    const id = await ensureLedger();
    if (id) toast({ title: '지급대장 헤더 저장됨' });
    onChanged?.();
  }

  async function issue(channel: 'manual' | 'app') {
    const name = selectedRecipient?.name.replace(/\s*\(.*\)$/, '') || workerName.trim();
    if (!name || !itemName.trim()) {
      toast({ title: '수령자와 품목을 입력하세요.', variant: 'destructive' });
      return;
    }
    let signature = '';
    if (channel === 'manual') {
      if (sigRef.current?.isEmpty()) {
        toast({ title: '수령 서명이 필요합니다.', variant: 'destructive' });
        return;
      }
      signature = sigRef.current!.toDataURL('image/png');
    }
    const qty = Math.max(1, Number(quantity) || 1);
    const ledgerId = await ensureLedger();
    if (!ledgerId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('issue_ppe_entry', {
        _ledger_id: ledgerId,
        _issued_at: issuedAt,
        _worker_name: name,
        _item_name: itemName.trim(),
        _quantity: qty,
        _signature_data: signature,
        _worker_id: selectedRecipient?.workerId || null,
        _user_id: selectedRecipient?.userId || null,
        _recipient_role: selectedRecipient?.role || 'worker',
        _specification: specification.trim(),
        _maker: maker.trim(),
        _channel: channel,
      });
      if (error) throw error;
      const status = (data as any)?.receipt_status;
      toast({
        title: status === 'pending' ? '앱 수령확인 요청됨' : '지급·서명 기록됨 (수불 출고)',
        description: status === 'pending' ? '수령자가 앱에서 서명하면 지급대장·수불대장에 기록됩니다.' : undefined,
      });
      setSignOpen(false);
      setWorkerName('');
      setRecipientKey('');
      setQuantity('1');
      setSpecification('');
      setMaker('');
      sigRef.current?.clear();
      await load();
      onChanged?.();
    } catch (e: any) {
      const msg = e.message || String(e);
      toast({
        title: '지급 실패',
        description: /insufficient_ppe_stock/i.test(msg) ? '재고가 부족합니다. 수불대장에서 입고를 확인하세요.' : msg,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(id: string) {
    if (!window.confirm('이 지급 기록을 삭제할까요?')) return;
    const row = entries.find((e) => e.id === id);
    await supabase.from('safety_cost_ppe_ledger_entries' as any).update({ is_deleted: true, receipt_status: 'cancelled' }).eq('id', id);
    if (row?.stock_movement_id) {
      await supabase.from('safety_cost_ppe_stock_movements' as any)
        .update({ is_deleted: true })
        .eq('id', row.stock_movement_id);
    } else {
      await supabase.from('safety_cost_ppe_stock_movements' as any)
        .update({ is_deleted: true })
        .eq('source_issuance_id', id);
    }
    await load();
    onChanged?.();
  }

  function printLedger() {
    const rows = entries.map((e) => `
      <tr>
        <td>${e.issued_at}</td>
        <td>${escape(e.worker_name)}</td>
        <td>${escape(e.item_name)}</td>
        <td>${e.quantity || 1}</td>
        <td>${e.signature_data?.startsWith('data:') ? `<img src="${e.signature_data}" style="height:36px"/>` : escape(e.signature_data || e.receipt_status || '')}</td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>보호구 지급대장</title>
      <style>body{font-family:'Malgun Gothic',sans-serif;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:6px;font-size:12px}th{background:#eef2f7}.meta{margin-bottom:12px;font-size:13px}.note{margin-top:16px;font-size:11px;line-height:1.5}</style></head>
      <body>
      <h1 style="text-align:center;font-size:20px">보호구 지급대장</h1>
      <div class="meta">현장명: ${escape(siteLabel)} · 안전관리자: ${escape(managerName)} · 서명 ${signedCount}건</div>
      <table><thead><tr><th>지급일자</th><th>성명</th><th>품목</th><th>수량</th><th>수령서명</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="note">
        ■ 근로자 준수 의무사항<br/>
        1. 산업안전보건기준에 관한 규칙에 따라 지급받은 보호구를 착용합니다.<br/>
        2. 분실·고의파손·미반납 시 회사가 요구하는 금액을 배상합니다.<br/>
        3. 미착용으로 인한 조치에 따릅니다.
      </div>
      <script>onload=()=>setTimeout(()=>print(),200)</script>
      </body></html>`;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(html);
    w.document.close();
  }

  if (loading) return <div className="text-sm text-muted-foreground py-6">지급대장 로딩 중…</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> 보호구 지급대장
            </CardTitle>
            <Badge variant={signedCount > 0 ? 'default' : 'secondary'}>서명 {signedCount}건</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            작성자가 수기 서명하거나, 근로자·관리자가 앱에서 수령확인하면 지급대장과 수불대장에 서명·일시가 함께 기록됩니다.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>현장명</Label>
              <Input value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>안전관리자</Label>
              <Input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="성명" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>지급 품목 컬럼 (쉼표 구분)</Label>
              <Input value={itemColumnsText} onChange={(e) => setItemColumnsText(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={saveHeader}>헤더 저장</Button>
            <Button size="sm" onClick={() => { setItemName(itemColumns[0] || ''); setSignOpen(true); }} className="gap-1">
              <Plus className="h-4 w-4" /> 지급 등록
            </Button>
            <Button size="sm" variant="outline" onClick={printLedger} disabled={!entries.length} className="gap-1">
              <Printer className="h-4 w-4" /> 인쇄
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>지급일</TableHead>
                <TableHead>성명</TableHead>
                <TableHead>품목</TableHead>
                <TableHead>수량</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>서명</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{e.issued_at}</TableCell>
                  <TableCell className="text-sm font-medium">{e.worker_name}</TableCell>
                  <TableCell className="text-xs">{e.item_name}{e.specification ? ` / ${e.specification}` : ''}</TableCell>
                  <TableCell className="text-xs">{e.quantity || 1}</TableCell>
                  <TableCell>
                    <Badge variant={e.receipt_status === 'confirmed' || e.signature_data ? 'default' : 'secondary'} className="text-[10px]">
                      {e.receipt_status === 'pending' ? '앱 수령대기' : e.receipt_channel === 'legacy' ? '이관' : e.receipt_channel === 'app' ? '앱수령' : '수기'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {e.signature_data?.startsWith('data:')
                      ? <img src={e.signature_data} alt="서명" className="h-8 max-w-[100px] object-contain" />
                      : e.signature_data
                        ? <Badge variant="secondary" className="text-[10px]">{e.signature_data === 'legacy-scan' ? '스캔서명' : e.signature_data}</Badge>
                        : <span className="text-xs text-muted-foreground">없음</span>}
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeEntry(e.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground text-sm">
                    아직 지급 기록이 없습니다. 「지급 등록」으로 시작하세요.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>보호구 지급</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>지급일</Label>
                <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>수량</Label>
                <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>품목</Label>
                <Input list="ppe-items" value={itemName} onChange={(e) => setItemName(e.target.value)} />
                <datalist id="ppe-items">
                  {itemColumns.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label>규격</Label>
                <Input value={specification} onChange={(e) => setSpecification(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>메이커</Label>
                <Input value={maker} onChange={(e) => setMaker(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>수령자 (근로자·관리자)</Label>
              <Select value={recipientKey || undefined} onValueChange={(v) => {
                setRecipientKey(v);
                const r = recipients.find((x) => x.key === v);
                if (r) setWorkerName(r.name.replace(/\s*\(.*\)$/, ''));
              }}>
                <SelectTrigger><SelectValue placeholder="명부에서 선택" /></SelectTrigger>
                <SelectContent>
                  {recipients.map((r) => (
                    <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input className="mt-1" value={workerName} onChange={(e) => { setWorkerName(e.target.value); setRecipientKey(''); }} placeholder="또는 성명 직접 입력" />
            </div>
            <div className="space-y-1">
              <Label>수기 서명 (앱 요청 시 생략)</Label>
              <div className="rounded-md border bg-background">
                <ResponsiveSignaturePad ref={sigRef} height={140} />
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => sigRef.current?.clear()}>서명 지우기</Button>
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSignOpen(false)}>취소</Button>
            <Button variant="secondary" disabled={saving} onClick={() => issue('app')}>앱 수령확인 요청</Button>
            <Button disabled={saving} onClick={() => issue('manual')}>수기 서명 저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function escape(s: string) {
  return String(s || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] || ch));
}
