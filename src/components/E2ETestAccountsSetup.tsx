import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, TestTube2, ShieldAlert } from "lucide-react";

const ENV_SNIPPET = `E2E_WORKER_EMAIL=worker@test.com
E2E_WORKER_PASSWORD=Test1234!@
E2E_CONTRACTOR_EMAIL=sub@test.com
E2E_CONTRACTOR_PASSWORD=Test1234!@
E2E_ADMIN_EMAIL=admin@test.com
E2E_ADMIN_PASSWORD=Test1234!@`;

type AccountResult = { email: string; status: string; user_id?: string; error?: string };

export function E2ETestAccountsSetup() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<AccountResult[]>([]);

  // Hard guard: never render for non-master users.
  if (!hasRole("master")) return null;

  const handleSetup = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("로그인 세션이 만료되었습니다. 다시 로그인해주세요.");
      const { data, error } = await supabase.functions.invoke("setup-e2e-accounts", {
        body: {},
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResults((data as any)?.accounts ?? []);
      setOpen(true);
      toast({ title: "E2E 계정 셋업 완료", description: "환경변수 스니펫을 확인하고 복사하세요." });
    } catch (e: any) {
      toast({
        title: "셋업 실패",
        description: e?.message ?? "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ENV_SNIPPET);
      toast({ title: "클립보드에 복사되었습니다" });
    } catch {
      toast({ title: "복사 실패", description: "수동으로 선택하여 복사하세요.", variant: "destructive" });
    }
  };

  return (
    <>
      <Card className="border-warning/40">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TestTube2 className="h-4 w-4 text-warning" />
            ⚙️ 시스템 E2E 테스트 계정 셋업
            <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">
              마스터 전용
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs flex items-start gap-1.5 mt-1">
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
            <span>
              QA/E2E 자동화용 고정 테스트 계정 3종(근로자·협력사 소장·원청 안전관리자)을 원클릭으로 생성합니다.
              프로덕션 사용자에게는 절대 노출되지 않으며, 서버(Edge Function)에서 마스터 권한을 재검증합니다.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleSetup} disabled={loading} size="sm">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <TestTube2 className="h-4 w-4 mr-2" />}
            테스트 계정 생성 / 재설정
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>E2E 테스트 계정 준비 완료</DialogTitle>
            <DialogDescription>
              아래 환경변수를 <code>.env.e2e</code> 파일에 저장하여 사용하세요.
            </DialogDescription>
          </DialogHeader>

          {results.length > 0 && (
            <div className="space-y-1 text-xs">
              {results.map((r) => (
                <div key={r.email} className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      r.status === "error"
                        ? "border-destructive/40 text-destructive"
                        : "border-success/40 text-success"
                    }
                  >
                    {r.status}
                  </Badge>
                  <span className="font-mono">{r.email}</span>
                  {r.error && <span className="text-destructive">{r.error}</span>}
                </div>
              ))}
            </div>
          )}

          <Textarea readOnly value={ENV_SNIPPET} rows={8} className="font-mono text-xs" />

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>닫기</Button>
            <Button onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-2" /> 클립보드에 복사
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
