import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { useToast } from "@/hooks/use-toast";
import { fetchProjectCompanies } from "@/lib/projectCompanies";
import { isGcType } from "@/lib/companyTypes";
import {
  allowedCompanyModes,
  canComposeAnnouncement,
  filterAnnouncementRecipients,
  resolveAudienceCompanyIds,
  summarizeAudience,
  validateAnnouncementAudience,
  type AnnouncementAudience,
  type AnnouncementAuthor,
  type AnnouncementCompanyMode,
  type AnnouncementPeople,
} from "@/lib/projectAnnouncements";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Megaphone, Plus, Users, Ban } from "lucide-react";
import { format } from "date-fns";

type Row = {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  require_ack: boolean;
  published_at: string;
  expires_at: string | null;
  is_withdrawn: boolean;
  recipient_count: number;
  created_by: string | null;
};

const MODE_LABEL: Record<AnnouncementCompanyMode, string> = {
  project_all: "현장 전체",
  own_tree: "내 회사 (하위 협력사 포함)",
  one_gc: "특정 시공사 (하위 포함)",
  one_company: "특정 회사만",
};

export default function ProjectAnnouncements() {
  const { user } = useAuth();
  const access = useGlobalProjectAccess();
  const { toast } = useToast();
  const projectId = access.selectedProject;

  const author: AnnouncementAuthor = {
    isMaster: access.isMaster,
    role: access.userRole,
    companyId: access.userCompanyId,
    companyType: access.userCompanyType,
  };
  const canWrite = canComposeAnnouncement(author);
  const modes = allowedCompanyModes(author);

  const [rows, setRows] = useState<Row[]>([]);
  const [ackCounts, setAckCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [requireAck, setRequireAck] = useState(false);
  const [companyMode, setCompanyMode] = useState<AnnouncementCompanyMode>(modes[0] || "own_tree");
  const [people, setPeople] = useState<AnnouncementPeople>("all");
  const [pickedCompany, setPickedCompany] = useState("");
  const [companies, setCompanies] = useState<{ id: string; name: string; type: string | null; parent_company_id?: string | null }[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const load = async () => {
    if (!projectId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("project_announcements")
      .select("id, title, body, audience, require_ack, published_at, expires_at, is_withdrawn, recipient_count, created_by")
      .eq("project_id", projectId)
      .order("published_at", { ascending: false });
    if (error) toast({ title: "공지 조회 실패", description: error.message, variant: "destructive" });
    const list = (data || []) as Row[];
    setRows(list);
    if (list.length) {
      const ids = list.map((r) => r.id);
      const { data: acks } = await supabase
        .from("project_announcement_acks")
        .select("announcement_id")
        .in("announcement_id", ids);
      const counts: Record<string, number> = {};
      for (const a of acks || []) {
        counts[a.announcement_id] = (counts[a.announcement_id] || 0) + 1;
      }
      setAckCounts(counts);
    } else {
      setAckCounts({});
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    fetchProjectCompanies(projectId).then(setCompanies).catch(() => setCompanies([]));
  }, [projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    const audience: AnnouncementAudience = {
      companyMode,
      companyIds: pickedCompany ? [pickedCompany] : [],
      includeDescendants: companyMode !== "one_company",
      people,
    };
    (async () => {
      const { data } = await supabase
        .from("project_members")
        .select("user_id, role_new, company_id")
        .eq("project_id", projectId);
      const companyIds = resolveAudienceCompanyIds(audience, author, companies);
      const ids = filterAnnouncementRecipients((data || []) as any[], companyIds, people).filter((id) => id !== user?.id);
      setPreviewCount(ids.length);
    })();
  }, [open, projectId, companyMode, people, pickedCompany, companies, user?.id]);

  const audienceDraft = (): AnnouncementAudience => ({
    companyMode,
    companyIds: pickedCompany ? [pickedCompany] : [],
    includeDescendants: companyMode !== "one_company",
    people,
  });

  const handlePublish = async () => {
    if (!projectId || !title.trim()) return;
    const audience = audienceDraft();
    const check = validateAnnouncementAudience(author, audience, companies);
    if (!check.ok) {
      toast({ title: check.error, variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("publish_project_announcement", {
      _project_id: projectId,
      _title: title.trim(),
      _body: body.trim(),
      _audience: audience as any,
      _require_ack: requireAck,
      _expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      _author_company_id: access.userCompanyId,
    });
    setSaving(false);
    if (error) {
      toast({ title: "게시 실패", description: error.message, variant: "destructive" });
      return;
    }
    const n = (data as any)?.recipient_count ?? previewCount ?? 0;
    toast({ title: "공지를 게시했습니다", description: `앱 계정 ${n}명에게 푸시가 나갑니다.` });
    setOpen(false);
    setTitle("");
    setBody("");
    setExpiresAt("");
    setRequireAck(false);
    void load();
  };

  const handleWithdraw = async (id: string) => {
    const { error } = await supabase.rpc("withdraw_project_announcement", { _announcement_id: id });
    if (error) {
      toast({ title: "회수 실패", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "공지를 회수했습니다" });
    void load();
  };

  const gcCompanies = companies.filter((c) => isGcType(c.type));
  const pickList = companyMode === "one_gc" ? gcCompanies : companies;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-5 w-5" /> 현장 공지
          </h1>
          <p className="text-sm text-muted-foreground">
            작업중지·기상·출입통제 등 현장 운영 안내. 대상자 핸드폰으로 한 번만 갑니다.
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> 공지 작성
          </Button>
        )}
      </header>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">로딩 중...</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="text-center text-muted-foreground py-12">등록된 현장 공지가 없습니다.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((n) => {
            const expired = n.expires_at && new Date(n.expires_at) < new Date();
            const acks = ackCounts[n.id] || 0;
            return (
              <Card key={n.id} className={n.is_withdrawn ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">{n.title}</CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={n.require_ack ? "destructive" : "secondary"}>
                        {n.require_ack ? "필독" : "안내"}
                      </Badge>
                      <Badge variant="outline">
                        <Users className="h-3 w-3 mr-1" />
                        확인 {acks}/{n.recipient_count}
                      </Badge>
                      {n.is_withdrawn ? (
                        <Badge variant="outline">회수됨</Badge>
                      ) : expired ? (
                        <Badge variant="outline">만료</Badge>
                      ) : (
                        <Badge>게시중</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {n.body && <p className="text-sm whitespace-pre-wrap">{n.body}</p>}
                  <p className="text-xs text-muted-foreground">
                    {summarizeAudience(n.audience || { companyMode: "project_all", companyIds: [], includeDescendants: true, people: "all" })}
                    {" · "}게시 {format(new Date(n.published_at), "yyyy-MM-dd HH:mm")}
                    {n.expires_at && <> · 만료 {format(new Date(n.expires_at), "yyyy-MM-dd HH:mm")}</>}
                  </p>
                  {!n.is_withdrawn && canWrite && (
                    <Button size="sm" variant="outline" onClick={() => handleWithdraw(n.id)}>
                      <Ban className="h-3.5 w-3.5 mr-1" /> 회수
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>현장 공지 작성</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>제목</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 내일 강풍으로 크레인 작업 중지" />
            </div>
            <div>
              <Label>내용</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
            </div>
            <div>
              <Label>회사 범위</Label>
              <Select value={companyMode} onValueChange={(v) => setCompanyMode(v as AnnouncementCompanyMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modes.map((m) => (
                    <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(companyMode === "one_gc" || companyMode === "one_company") && (
              <div>
                <Label>대상 회사</Label>
                <Select value={pickedCompany} onValueChange={setPickedCompany}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {pickList.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>사람</Label>
              <Select value={people} onValueChange={(v) => setPeople(v as AnnouncementPeople)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전원</SelectItem>
                  <SelectItem value="managers">관리자</SelectItem>
                  <SelectItem value="workers">근로자</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm font-medium">필독 (확인 전까지 앱에서 모달)</p>
                <p className="text-[11px] text-muted-foreground">끄면 안내 배너만 뜨고, 확인하면 사라집니다. 재푸시는 없습니다.</p>
              </div>
              <Switch checked={requireAck} onCheckedChange={setRequireAck} />
            </div>
            <div>
              <Label>만료일시 (선택)</Label>
              <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            {previewCount != null && (
              <p className="text-xs text-muted-foreground">
                앱에 로그인한 계정 <strong>{previewCount}명</strong>에게 푸시가 1회 나갑니다. 명부에만 있고 미가입인 인원은 제외됩니다.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handlePublish} disabled={saving || !title.trim()}>게시</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
