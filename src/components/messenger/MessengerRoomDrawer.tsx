import { useEffect, useMemo, useState } from "react";
import {
  fetchChatContacts,
  fetchRoomAttachments,
  inviteChatParticipants,
  leaveChatRoom,
  deleteChatRoom,
  setChatRoomName,
  type ChatAttachment,
  type ChatContact,
  type ChatRoom,
} from "@/lib/messengerApi";
import { dedupeChatContacts, groupContactsByCompany } from "@/lib/chatMessages";
import { formatBytes } from "@/lib/compressUploadFile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2,
  Download,
  Edit3,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LogOut,
  Save,
  Trash2,
  Settings,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface MessengerRoomDrawerProps {
  room: ChatRoom;
  isOpen: boolean;
  onClose: () => void;
  onRoomUpdated?: () => void;
  onRoomLeft?: () => void;
}

export function MessengerRoomDrawer({
  room,
  isOpen,
  onClose,
  onRoomUpdated,
  onRoomLeft,
}: MessengerRoomDrawerProps) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  // 추가 초대 상태
  const [inviteMode, setInviteMode] = useState(false);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [inviteSearch, setInviteSearch] = useState("");
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);

  // 방 이름 수정 상태
  const initialName = room.custom_name || room.name || "";
  const [roomNameInput, setRoomNameInput] = useState(initialName);
  const [savingName, setSavingName] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { user } = useAuth();
  const canDeleteGroup = Boolean(
    room.is_group && user?.id && room.created_by && room.created_by === user.id,
  );

  useEffect(() => {
    setRoomNameInput(room.custom_name || room.name || "");
  }, [room.id, room.custom_name, room.name]);

  useEffect(() => {
    if (!isOpen || !room.id) return;
    setLoadingMedia(true);
    fetchRoomAttachments(room.id)
      .then((res) => setAttachments(res))
      .finally(() => setLoadingMedia(false));
  }, [isOpen, room.id]);

  useEffect(() => {
    if (!isOpen || !inviteMode) return;
    fetchChatContacts(room.project_id, inviteSearch).then((res) => {
      const existingIds = new Set((room.participants || []).map((p) => p.user_id));
      const available = dedupeChatContacts(res).filter((c) => !existingIds.has(c.user_id));
      setContacts(available);
    });
  }, [isOpen, inviteMode, room.project_id, room.participants, inviteSearch]);

  const participantGroups = useMemo(() => {
    const list = (room.participants || []).map((p) => ({
      ...p,
      company_name: p.company_name || "소속 미지정",
      full_name: p.full_name || "사용자",
    }));
    return groupContactsByCompany(list);
  }, [room.participants]);

  const images = useMemo(
    () => attachments.filter((a) => a.mime_type.startsWith("image/")),
    [attachments],
  );
  const files = useMemo(
    () => attachments.filter((a) => !a.mime_type.startsWith("image/")),
    [attachments],
  );

  const toggleInviteUser = (userId: string) => {
    setSelectedInviteIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const handleInviteSubmit = async () => {
    if (selectedInviteIds.length === 0 || inviting) return;
    setInviting(true);
    try {
      const added = await inviteChatParticipants(room.id, selectedInviteIds);
      if (added > 0) {
        toast.success(`${added}명을 대화방에 초대했습니다.`);
        setInviteMode(false);
        setSelectedInviteIds([]);
        onRoomUpdated?.();
      } else {
        toast.error("같은 현장의 관리자만 초대할 수 있습니다. 발주처는 같은 회사 사람도 초대됩니다. 이미 참여 중이거나 권한이 없는 사람은 빠집니다.");
      }
    } finally {
      setInviting(false);
    }
  };

  const handleSaveRoomName = async (forEveryone: boolean) => {
    if (savingName) return;
    setSavingName(true);
    try {
      const ok = await setChatRoomName(room.id, roomNameInput.trim(), forEveryone);
      if (ok) {
        toast.success("대화방 이름이 변경되었습니다.");
        onRoomUpdated?.();
      } else {
        toast.error("대화방 이름 변경에 실패했습니다.");
      }
    } finally {
      setSavingName(false);
    }
  };

  const handleDeleteRoom = async () => {
    if (deleting || !canDeleteGroup) return;
    if (!window.confirm("이 그룹 대화방을 삭제하면 모든 참여자의 목록에서 사라집니다. 되돌릴 수 없습니다.")) {
      return;
    }
    setDeleting(true);
    try {
      const ok = await deleteChatRoom(room.id);
      if (ok) {
        toast.success("그룹 대화방을 삭제했습니다.");
        onClose();
        onRoomLeft?.();
      } else {
        toast.error("대화방 삭제에 실패했습니다. 방을 만든 사람만 삭제할 수 있습니다.");
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (leaving) return;
    if (!window.confirm("이 대화방에서 나가시겠습니까?")) return;
    setLeaving(true);
    try {
      const ok = await leaveChatRoom(room.id);
      if (ok) {
        toast.success("대화방에서 나갔습니다.");
        onClose();
        onRoomLeft?.();
      } else {
        toast.error("대화방 나가기에 실패했습니다.");
      }
    } finally {
      setLeaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-y-0 right-0 w-full sm:w-80 bg-background border-l shadow-xl z-30 flex flex-col animate-in slide-in-from-right duration-200">
      {/* 서랍 헤더 */}
      <div className="px-3.5 py-2.5 border-b bg-muted/30 flex items-center justify-between shrink-0">
        <span className="text-sm font-semibold flex items-center gap-1.5">
          <FolderOpen className="h-3.5 w-3.5 text-primary" />
          대화방 서랍 · 정보
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="대화방 서랍 닫기"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="participants" className="flex-1 flex flex-col min-h-0">
        <div className="px-3 pt-2.5 border-b bg-muted/10 shrink-0">
          <TabsList className="grid w-full grid-cols-3 h-8">
            <TabsTrigger value="participants" className="text-xs">
              참여자 ({room.participants?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="media" className="text-xs">
              사진·파일 ({attachments.length})
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs">
              방 설정
            </TabsTrigger>
          </TabsList>
        </div>

        {/* 1. 참여자 및 추가 초대 탭 */}
        <TabsContent value="participants" className="flex-1 overflow-y-auto p-3 space-y-3 m-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              소속 업체별 참여자 현황
            </span>
            <Button
              type="button"
              size="sm"
              variant={inviteMode ? "secondary" : "outline"}
              className="h-7 px-2.5 text-xs gap-1"
              onClick={() => {
                setInviteMode((v) => !v);
                setSelectedInviteIds([]);
              }}
            >
              <UserPlus className="h-3 w-3" />
              <span>{inviteMode ? "초대 닫기" : "대화상대 초대"}</span>
            </Button>
          </div>

          {inviteMode && (
            <div className="p-2.5 rounded-xl border bg-muted/30 space-y-2 animate-in fade-in">
              <Input
                placeholder="초대할 관리자 이름/회사 검색..."
                value={inviteSearch}
                onChange={(e) => setInviteSearch(e.target.value)}
                className="h-7 text-xs bg-background"
              />
              <div className="max-h-40 overflow-y-auto divide-y border rounded-lg bg-card">
                {contacts.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    초대 가능한 관리자가 없습니다.
                  </div>
                ) : (
                  contacts.map((c) => {
                    const checked = selectedInviteIds.includes(c.user_id);
                    return (
                      <label
                        key={c.user_id}
                        className="flex items-center justify-between p-2 text-xs hover:bg-muted/50 cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleInviteUser(c.user_id)}
                          />
                          <div className="min-w-0">
                            <p className="font-medium truncate text-xs">
                              {c.full_name || "관리자"}
                              {c.role ? ` (${c.role})` : ""}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {c.company_name || "소속 미지정"}
                              {c.project_label ? ` · ${c.project_label}` : ""}
                            </p>
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
              <Button
                type="button"
                size="sm"
                className="w-full h-7 text-xs"
                disabled={selectedInviteIds.length === 0 || inviting}
                onClick={() => void handleInviteSubmit()}
              >
                {inviting
                  ? "초대 중..."
                  : `${selectedInviteIds.length}명 대화방에 초대하기`}
              </Button>
            </div>
          )}

          <div className="space-y-3">
            {participantGroups.map((group) => (
              <div key={group.companyName} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground px-1">
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3 text-primary" />
                    {group.companyName}
                  </span>
                  <span>{group.members.length}명</span>
                </div>
                <div className="space-y-1">
                  {group.members.map((p) => (
                    <div
                      key={p.user_id}
                      className="flex items-center justify-between p-2 rounded-lg border bg-card text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {p.full_name?.slice(0, 1) || <User className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm truncate">
                              {p.full_name}
                            </span>
                            {p.role && (
                              <span className="text-xs px-1.5 py-0.2 rounded bg-muted text-muted-foreground shrink-0">
                                {p.role}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* 2. 사진 및 파일 모아보기 탭 */}
        <TabsContent value="media" className="flex-1 overflow-y-auto p-3 space-y-4 m-0">
          {loadingMedia ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              공유된 사진과 파일을 불러오는 중...
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-1">
                    <ImageIcon className="h-3.5 w-3.5 text-primary" />
                    현장 사진 ({images.length})
                  </span>
                </div>
                {images.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground border rounded-lg bg-muted/20">
                    공유된 사진이 없습니다.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {images.map((img) => (
                      <a
                        key={img.id}
                        href={img.public_url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square rounded-lg overflow-hidden border bg-muted hover:opacity-90 transition-opacity"
                        title={img.file_name}
                      >
                        <img
                          src={img.thumbnail_url || img.public_url || ""}
                          alt={img.file_name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    문서 및 첨부파일 ({files.length})
                  </span>
                </div>
                {files.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground border rounded-lg bg-muted/20">
                    공유된 문서 파일이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {files.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between p-2 rounded-lg border bg-card text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-primary shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{f.file_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(f.file_size)}
                            </p>
                          </div>
                        </div>
                        {f.public_url && (
                          <a
                            href={f.public_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={f.file_name}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                            title="파일 다운로드"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        {/* 3. 방 설정 탭 */}
        <TabsContent value="settings" className="flex-1 overflow-y-auto p-3 space-y-4 m-0">
          <div className="space-y-2 p-3 rounded-xl border bg-card">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              <Edit3 className="h-3.5 w-3.5 text-primary" />
              대화방 이름 설정
            </label>
            <Input
              value={roomNameInput}
              onChange={(e) => setRoomNameInput(e.target.value)}
              placeholder="예: 3공구 골조·안전 일일점검방"
              className="h-8 text-xs"
              maxLength={60}
            />
            <div className="flex items-center gap-1.5 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={savingName}
                onClick={() => void handleSaveRoomName(false)}
                className="flex-1 h-7 text-xs gap-1"
              >
                <Save className="h-3 w-3" />
                <span>내 화면만 변경</span>
              </Button>
              {room.is_group && (
                <Button
                  type="button"
                  size="sm"
                  disabled={savingName}
                  onClick={() => void handleSaveRoomName(true)}
                  className="flex-1 h-7 text-xs gap-1"
                >
                  <Users className="h-3 w-3" />
                  <span>공용 방 이름 변경</span>
                </Button>
              )}
            </div>
          </div>

          {canDeleteGroup && (
            <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5 space-y-2">
              <div className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                그룹 대화방 삭제
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                내가 만든 그룹방입니다. 삭제하면 참여자 모두의 목록에서 방과 대화가 사라집니다.
              </p>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={() => void handleDeleteRoom()}
                className="w-full h-8 text-xs gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{deleting ? "삭제 중..." : "이 그룹 대화방 삭제"}</span>
              </Button>
            </div>
          )}

          <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5 space-y-2">
            <div className="text-xs font-semibold text-destructive flex items-center gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              대화방 나가기
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              대화방을 나가면 내 목록에서 제거되며 더 이상 이 방의 알림을 받지 않습니다.
            </p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={leaving}
              onClick={() => void handleLeaveRoom()}
              className="w-full h-8 text-xs gap-1.5"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>{leaving ? "나가는 중..." : "이 대화방 나가기"}</span>
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
