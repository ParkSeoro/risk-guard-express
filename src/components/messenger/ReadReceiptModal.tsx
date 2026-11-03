import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchChatMessageReadReceipts, type ChatReadReceiptsResult } from "@/lib/messengerApi";
import { CheckCheck, Clock, Phone, ShieldCheck, User } from "lucide-react";

interface ReadReceiptModalProps {
  messageId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ReadReceiptModal({ messageId, isOpen, onClose }: ReadReceiptModalProps) {
  const [data, setData] = useState<ChatReadReceiptsResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !messageId) {
      setData(null);
      return;
    }
    setLoading(true);
    fetchChatMessageReadReceipts(messageId)
      .then((res) => {
        setData(res);
      })
      .finally(() => setLoading(false));
  }, [isOpen, messageId]);

  const readers = data?.readers || [];
  const unreaders = data?.unreaders || [];

  const formatReadTime = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return isoString;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 overflow-hidden bg-background">
        <DialogHeader className="p-4 border-b bg-muted/40">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <CheckCheck className="h-4 w-4 text-primary" />
            읽음 확인 현황 (라인웍스 스타일)
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            읽음 현황을 집계 중입니다...
          </div>
        ) : data?.error ? (
          <div className="py-12 text-center text-xs text-destructive">
            {data.error}
          </div>
        ) : (
          <Tabs defaultValue="readers" className="flex-1 flex flex-col min-h-0">
            <div className="px-4 pt-3 border-b bg-muted/20">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="readers" className="text-xs">
                  읽은 사람 ({readers.length})
                </TabsTrigger>
                <TabsTrigger value="unreaders" className="text-xs">
                  안 읽은 사람 ({unreaders.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="readers" className="flex-1 overflow-y-auto p-4 space-y-2.5 m-0">
              {readers.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  아직 읽은 사용자가 없습니다.
                </div>
              ) : (
                readers.map((r) => (
                  <div
                    key={r.user_id}
                    className="flex items-center justify-between p-2.5 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                        {r.name?.slice(0, 1) || <User className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{r.name || "사용자"}</span>
                          {r.role && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                              {r.role}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {r.company || "소속 미지정"}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end shrink-0 pl-2">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatReadTime(r.read_at)}
                      </span>
                      {r.phone ? (
                        <a
                          href={`tel:${r.phone}`}
                          className="text-[10px] text-primary hover:underline flex items-center gap-0.5 mt-0.5"
                        >
                          <Phone className="h-2.5 w-2.5" />
                          {r.phone}
                        </a>
                      ) : (
                        <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5 mt-0.5" title="개인정보 보호를 위해 타사 전화번호는 은닉됩니다">
                          <ShieldCheck className="h-2.5 w-2.5 text-muted-foreground/60" />
                          타사 연락처 보호
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="unreaders" className="flex-1 overflow-y-auto p-4 space-y-2.5 m-0">
              {unreaders.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  모든 참여자가 메시지를 확인했습니다! 🎉
                </div>
              ) : (
                unreaders.map((u) => (
                  <div
                    key={u.user_id}
                    className="flex items-center justify-between p-2.5 rounded-lg border bg-card/60"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                        {u.name?.slice(0, 1) || <User className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{u.name || "사용자"}</span>
                          {u.role && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                              {u.role}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {u.company || "소속 미지정"}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium shrink-0">
                      미확인
                    </span>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
