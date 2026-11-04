import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { fetchChatContacts, createChatRoom, type ChatContact } from "@/lib/messengerApi";
import { Search, ShieldAlert, User, Users, Phone, Building2 } from "lucide-react";
import { toast } from "sonner";

interface NewChatDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRoomCreated: (roomId: string) => void;
  currentProjectId?: string | null;
}

export function NewChatDialog({
  isOpen,
  onClose,
  onRoomCreated,
  currentProjectId,
}: NewChatDialogProps) {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSelectedUserIds([]);
      setGroupName("");
      setSearchQuery("");
      return;
    }
    setLoading(true);
    fetchChatContacts(currentProjectId, searchQuery)
      .then((res) => setContacts(res))
      .finally(() => setLoading(false));
  }, [isOpen, currentProjectId, searchQuery]);

  const toggleSelect = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleCreate = async () => {
    if (selectedUserIds.length === 0) {
      toast.error("대화 상대를 1명 이상 선택해 주세요.");
      return;
    }

    const isGroup = selectedUserIds.length > 1;
    setSubmitting(true);
    try {
      const roomId = await createChatRoom({
        name: isGroup ? groupName.trim() || null : null,
        isGroup,
        projectId: currentProjectId || null,
        inviteUserIds: selectedUserIds,
      });

      if (roomId) {
        toast.success(isGroup ? "그룹 대화방이 생성되었습니다." : "대화방으로 이동합니다.");
        onRoomCreated(roomId);
        onClose();
      } else {
        toast.error("대화방 생성에 실패했습니다.");
      }
    } catch (err: any) {
      toast.error(err?.message || "오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const isGroup = selectedUserIds.length > 1;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 overflow-hidden bg-background">
        <DialogHeader className="p-4 border-b bg-muted/40">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            새 대화방 시작
          </DialogTitle>
          <DialogDescription className="text-xs">
            대화 상대를 선택해 1:1 대화 또는 그룹 채팅방을 개설합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-3.5 flex-1 overflow-y-auto">
          {/* 개인정보 보호 안내 배너 */}
          <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
            <div className="text-[11px] leading-relaxed">
              <span className="font-semibold">개인정보 보호 정책 적용</span>: 타사 관리자의 개인 휴대전화번호는 보호를 위해 은닉되며, 동일 소속 회사 직원 간에만 연락처가 노출됩니다.
            </div>
          </div>

          {/* 검색 입력 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="이름 또는 회사명으로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 text-xs h-9"
            />
          </div>

          {/* 그룹방 이름 입력 (2명 이상 선택 시 표시) */}
          {isGroup && (
            <div className="space-y-1.5 p-3 rounded-lg border bg-muted/30 animate-in fade-in">
              <Label className="text-xs font-medium">그룹 대화방 이름 (선택)</Label>
              <Input
                placeholder="예: 3공구 안전관리단 회의방"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="text-xs h-8"
                maxLength={40}
              />
            </div>
          )}

          {/* 대화 상대 목록 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <span>관리자 목록 ({contacts.length}명)</span>
              <span>{selectedUserIds.length}명 선택됨</span>
            </div>

            <div className="border rounded-md divide-y max-h-60 overflow-y-auto bg-card">
              {loading ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  대화 상대를 검색하는 중...
                </div>
              ) : contacts.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  검색 결과가 없습니다.
                </div>
              ) : (
                contacts.map((c) => {
                  const isChecked = selectedUserIds.includes(c.user_id);
                  return (
                    <label
                      key={c.user_id}
                      className="flex items-center justify-between p-2.5 hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleSelect(c.user_id)}
                          className="data-[state=checked]:bg-primary"
                        />
                        <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                          {c.full_name?.slice(0, 1) || <User className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium truncate">{c.full_name || "사용자"}</span>
                            {c.role && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground shrink-0">
                                {c.role}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                            <Building2 className="h-3 w-3 shrink-0" />
                            {c.company_name || "소속 미지정"}
                          </div>
                        </div>
                      </div>

                      {c.phone && (
                        <span className="text-[10px] text-primary flex items-center gap-0.5 shrink-0 pl-2">
                          <Phone className="h-2.5 w-2.5" />
                          {c.phone}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="p-3 border-t bg-muted/20 flex gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting} className="text-xs">
            취소
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={submitting || selectedUserIds.length === 0}
            className="text-xs"
          >
            {submitting ? "생성 중..." : isGroup ? `그룹 대화방 개설 (${selectedUserIds.length}명)` : "대화 시작하기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
