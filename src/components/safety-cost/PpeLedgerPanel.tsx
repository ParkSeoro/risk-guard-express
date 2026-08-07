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
import ResponsiveSignaturePad, { type ResponsiveSignaturePadHandle } from '@/components/ResponsiveSignaturePad';
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
  signature_data: string;
  signed_at: string | null;
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
  const [loading, setLoading] = useState(true);
  const [siteLabel, setSiteLabel] = useState(constructionName || '');
  const [managerName, setManagerName] = useState('');
  const [itemColumnsText, setItemColumnsText] = useState(
    (defaultItemNames?.length ? defaultItemNames : ['안전모', '안전화', '안전조끼']).join(', '),
  );
  const [signOpen, setSignOpen] = useState(false);
  const [workerName, setWorkerName] = useState('');
  const [issuedAt, setIssuedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [itemName, setItemName] = useState('');
  const sigRef = useRef<ResponsiveSignaturePadHandle | null>(null);

  const itemColumns = useMemo(
    () => itemColumnsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    [itemColumnsText],
  );

  const signedCount = entries.filter((e) => e.signature_data).length;

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
        signature_data: e.signature_data || '',
        signed_at: e.signed_at,
      })));
    } else {
      setLedger(null);
      setEntries([]);
    }
    setLoading(false);
  }, [reportId, constructionName]);

  useEffect(() => { load(); }, [load]);

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

  async function addSignedEntry() {
    if (!workerName.trim() || !itemName.trim()) {
      toast({ title: '근로자명과 품목을 입력하세요.', variant: 'destructive' });
      return;
    }
    if (sigRef.current?.isEmpty()) {
      toast({ title: '수령 서명이 필요합니다.', variant: 'destructive' });
      return;
    }
    const ledgerId = await ensureLedger();
    if (!ledgerId) return;
    const signature = sigRef.current!.toDataURL('image/png');
    const { error } = await supabase.from('safety_cost_ppe_ledger_entries' as any).insert({
      ledger_id: ledgerId,
      project_id: projectId,
      company_id: companyId,
      issued_at: issuedAt,
      worker_name: workerName.trim(),
      item_name: itemName.trim(),
      signature_data: signature,
      signed_at: new Date().toISOString(),
      sort_order: entries.length,
    });
    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '지급·서명 기록됨' });
    setSignOpen(false);
    setWorkerName('');
    sigRef.current?.clear();
    await load();
    onChanged?.();
  }

  async function removeEntry(id: string) {
    if (!window.confirm('이 지급 기록을 삭제할까요?')) return;
    await supabase.from('safety_cost_ppe_ledger_entries' as any).update({ is_deleted: true }).eq('id', id);
    await load();
    onChanged?.();
  }

  function printLedger() {
    const rows = entries.map((e) => `
      <tr>
        <td>${e.issued_at}</td>
        <td>${escape(e.worker_name)}</td>
        <td>${escape(e.item_name)}</td>
        <td>${e.signature_data ? `<img src="${e.signature_data}" style="height:36px"/>` : ''}</td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>보호구 지급대장</title>
      <style>body{font-family:'Malgun Gothic',sans-serif;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:6px;font-size:12px}th{background:#eef2f7}.meta{margin-bottom:12px;font-size:13px}.note{margin-top:16px;font-size:11px;line-height:1.5}</style></head>
      <body>
      <h1 style="text-align:center;font-size:20px">보호구 지급대장</h1>
      <div class="meta">현장명: ${escape(siteLabel)} · 안전관리자: ${escape(managerName)} · 서명 ${signedCount}건</div>
      <table><thead><tr><th>지급일자</th><th>성명</th><th>품목</th><th>수령서명</th></tr></thead><tbody>${rows}</tbody></table>
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
            보호구(3번)는 구매 증빙만으로는 부족합니다. 수령자 서명이 있는 지급대장이 있어야 상신할 수 있습니다.
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
              <Plus className="h-4 w-4" /> 지급·서명 추가
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
                <TableHead>서명</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{e.issued_at}</TableCell>
                  <TableCell className="text-sm font-medium">{e.worker_name}</TableCell>
                  <TableCell className="text-xs">{e.item_name}</TableCell>
                  <TableCell>
                    {e.signature_data
                      ? <img src={e.signature_data} alt="서명" className="h-8 max-w-[100px] object-contain" />
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
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground text-sm">
                    아직 지급 기록이 없습니다. 「지급·서명 추가」로 시작하세요.
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
            <DialogTitle>보호구 수령 서명</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>지급일</Label>
                <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>품목</Label>
                <Input list="ppe-items" value={itemName} onChange={(e) => setItemName(e.target.value)} />
                <datalist id="ppe-items">
                  {itemColumns.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>
            <div className="space-y-1">
              <Label>수령자 성명</Label>
              <Input value={workerName} onChange={(e) => setWorkerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>수령 서명</Label>
              <div className="rounded-md border bg-background">
                <ResponsiveSignaturePad ref={sigRef} height={140} />
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => sigRef.current?.clear()}>서명 지우기</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              서명 시 보호구 착용·분실배상·미착용 조치에 동의하는 것으로 기록됩니다.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOpen(false)}>취소</Button>
            <Button onClick={addSignedEntry}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function escape(s: string) {
  return String(s || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] || ch));
}
