import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Trash2, Smartphone, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

type Release = {
  id: string; version: string; channel: string; bundle_url: string;
  checksum: string | null; mandatory: boolean; min_native_version: string | null;
  notes: string | null; released_at: string; is_deleted: boolean;
};

export default function MobileReleases() {
  const { hasRole } = useAuth();
  const isMaster = hasRole("master");
  const [list, setList] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    version: "", channel: "stable", mandatory: false,
    min_native_version: "", notes: "",
  });
  const [file, setFile] = useState<File | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("app_releases" as any)
      .select("*")
      .eq("is_deleted", false)
      .order("released_at", { ascending: false });
    if (error) toast.error(error.message);
    setList((data as any) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (!isMaster) return <Navigate to="/" replace />;

  const submit = async () => {
    if (!form.version.trim()) { toast.error("버전을 입력하세요 (예: 1.2.0)"); return; }
    if (!file) { toast.error("번들 zip 파일을 선택하세요"); return; }
    setUploading(true);
    try {
      const path = `${form.channel}/${form.version}-${Date.now()}.zip`;
      const up = await supabase.storage.from("app-updates").upload(path, file, {
        contentType: "application/zip", upsert: false,
      });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("app-updates").getPublicUrl(path);

      // SHA-256 체크섬
      const buf = await file.arrayBuffer();
      const hashBuf = await crypto.subtle.digest("SHA-256", buf);
      const checksum = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0")).join("");

      const { error } = await supabase.from("app_releases" as any).insert({
        version: form.version.trim(),
        channel: form.channel,
        bundle_url: pub.publicUrl,
        checksum,
        mandatory: form.mandatory,
        min_native_version: form.min_native_version.trim() || null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
      toast.success("릴리스가 게시되었습니다");
      setForm({ version: "", channel: "stable", mandatory: false, min_native_version: "", notes: "" });
      setFile(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "업로드 실패");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (r: Release) => {
    if (!confirm(`v${r.version} (${r.channel}) 릴리스를 삭제할까요?`)) return;
    const { error } = await supabase.from("app_releases" as any)
      .update({ is_deleted: true }).eq("id", r.id);
    if (error) toast.error(error.message); else { toast.success("삭제됨"); load(); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Smartphone className="h-6 w-6" /> 모바일 앱 릴리스 (OTA)
      </h1>
      <p className="text-sm text-muted-foreground">
        네이티브 쉘은 그대로 두고 JS 번들만 무선 업데이트합니다. 권한·플러그인 추가 등 네이티브 변경 시에는 스토어 재제출이 필요합니다.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">새 릴리스 게시</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div><Label>버전 (semver)</Label>
            <Input value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="1.2.0" />
          </div>
          <div><Label>채널</Label>
            <Select value={form.channel} onValueChange={v => setForm({ ...form, channel: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">stable (전체 배포)</SelectItem>
                <SelectItem value="beta">beta (테스터)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>번들 zip ( dist/ 폴더 압축 )</Label>
            <Input type="file" accept=".zip" onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>
          <div><Label>최소 네이티브 버전 (선택)</Label>
            <Input value={form.min_native_version} onChange={e => setForm({ ...form, min_native_version: e.target.value })} placeholder="1.0.0" />
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <Switch checked={form.mandatory} onCheckedChange={c => setForm({ ...form, mandatory: c })} />
            <Label>필수 업데이트 (다운로드 직후 즉시 적용)</Label>
          </div>
          <div className="md:col-span-2"><Label>릴리스 노트</Label>
            <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="변경 사항" />
          </div>
          <div className="md:col-span-2">
            <Button onClick={submit} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              업로드 및 게시
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">게시된 릴리스</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">로딩…</div> :
            list.length === 0 ? <div className="text-sm text-muted-foreground">아직 릴리스가 없습니다.</div> :
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-2">버전</th><th>채널</th><th>필수</th><th>게시일</th><th>노트</th><th></th></tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 font-mono">{r.version}</td>
                    <td><Badge variant={r.channel === "stable" ? "default" : "secondary"}>{r.channel}</Badge></td>
                    <td>{r.mandatory ? <Badge variant="destructive">필수</Badge> : "-"}</td>
                    <td>{new Date(r.released_at).toLocaleString("ko-KR")}</td>
                    <td className="text-xs text-muted-foreground">{r.notes || "-"}</td>
                    <td><Button size="sm" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        </CardContent>
      </Card>
    </div>
  );
}
