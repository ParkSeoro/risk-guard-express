import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, QrCode, Search, UserPlus, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

export default function MobileWorkers() {
  const navigate = useNavigate();
  const projectId = typeof window !== "undefined" ? localStorage.getItem("selectedProjectId") || "" : "";
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [qr, setQr] = useState<{ name: string; img: string; url: string } | null>(null);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await supabase.from("workers").select("*")
      .eq("project_id", projectId).eq("is_active", true)
      .order("created_at", { ascending: false }).limit(200);
    setWorkers(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  const filtered = workers.filter(w =>
    !q || w.name?.includes(q) || w.phone?.includes(q) || w.company_name?.includes(q)
  );

  const showQr = async (w: any) => {
    const url = `${window.location.origin}/worker/portal/${w.qr_token}`;
    const img = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    setQr({ name: w.name, img, url });
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("복사됨"); }
    catch { toast.error("복사 실패"); }
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">근로자 QR</div>
        <Button size="sm" variant="secondary" onClick={() => navigate("/worker/register")}>
          <UserPlus className="h-4 w-4 mr-1" /> 등록
        </Button>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="이름/전화/업체"
            className="pl-9 h-11" />
        </div>

        {loading && <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div>}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-12 text-sm">근로자가 없습니다</div>
        )}

        {filtered.map(w => (
          <Card key={w.id}>
            <CardContent className="pt-3 pb-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{w.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {w.company_name || "—"} · {w.phone}
                </div>
                {w.education_confirmed_at && <Badge variant="secondary" className="text-[10px] mt-1">교육완료</Badge>}
              </div>
              <Button size="sm" variant="outline" onClick={() => showQr(w)}>
                <QrCode className="h-4 w-4 mr-1" /> QR
              </Button>
            </CardContent>
          </Card>
        ))}
      </main>

      {qr && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setQr(null)}>
          <Card className="w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <CardContent className="pt-4 space-y-3 text-center">
              <div className="font-bold">{qr.name}</div>
              <img src={qr.img} alt="QR" className="mx-auto rounded border" />
              <div className="text-xs text-muted-foreground break-all">{qr.url}</div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => copy(qr.url)}>
                  <Copy className="h-4 w-4 mr-1" /> 링크 복사
                </Button>
                <Button onClick={() => setQr(null)}>닫기</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
