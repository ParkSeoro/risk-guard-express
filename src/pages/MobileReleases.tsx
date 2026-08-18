import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Trash2, Smartphone, Loader2, Save } from "lucide-react";
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
  const [minDraft, setMinDraft] = useState("");
  const [savingMin, setSavingMin] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("app_releases" as any)
      .select("*")
      .eq("is_deleted", false)
      .order("released_at", { ascending: false });
    if (error) toast.error(error.message);
    const rows = ((data as any) || []) as Release[];
    setList(rows);
    const latest = rows.find((r) => r.channel === "stable") || rows[0];
    if (latest) setMinDraft(latest.min_native_version || "");
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const latestRelease = list.find((r) => r.channel === "stable") || list[0] || null;

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
      // 비공개 버킷이라 다운로드는 OTA 클라이언트가 서명 URL을 생성. 경로만 저장.
      const bundleUrl = `storage:${path}`;

      // SHA-256 체크섬
      const buf = await file.arrayBuffer();
      const hashBuf = await crypto.subtle.digest("SHA-256", buf);
      const checksum = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0")).join("");

      const { error } = await supabase.from("app_releases" as any).insert({
        version: form.version.trim(),
        channel: form.channel,
        bundle_url: bundleUrl,
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

  const saveMinNative = async (releaseId: string, value: string) => {
    const next = value.trim() || null;
    setSavingMin(true);
    const { error } = await supabase.from("app_releases" as any)
      .update({ min_native_version: next })
      .eq("id", releaseId);
    setSavingMin(false);
    if (error) toast.error(error.message);
    else {
      toast.success(next ? `최소 네이티브 버전 ${next} 저장됨` : "최소 네이티브 버전 지움");
      load();
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
        화면(JS)은 OTA로 바뀝니다. 새 AAB를 Play에 올린 뒤에는 최신 릴리스의
        <b>네이티브 최소</b>를 그 AAB의 <b>versionCode</b>(정수, 예: 470)로 저장하세요.
        비워 두면 Play 스토어 링크만 업데이트를 보여주고, 앱 실행 화면은 안 뜹니다.
      </p>

      {latestRelease && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">Play 스토어 최소 앱 (versionCode)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              최신 OTA <span className="font-mono">{latestRelease.version}</span> ({latestRelease.channel})에 저장합니다.
              폰 <b>더보기 → 앱 버전</b> 괄호 숫자보다 <b>큰</b> Play versionCode를 넣으세요. 예: 설치됨 468이면 새 AAB가 470이면 <span className="font-mono">470</span>.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1">
                <Label htmlFor="min-native-code">네이티브 최소 versionCode</Label>
                <Input
                  id="min-native-code"
                  inputMode="numeric"
                  placeholder="예: 470"
                  value={minDraft}
                  onChange={(e) => setMinDraft(e.target.value)}
                />
              </div>
              <Button
                type="button"
                disabled={savingMin}
                onClick={() => saveMinNative(latestRelease.id, minDraft)}
              >
                {savingMin ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                저장
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
          <div><Label>최소 네이티브 버전 (Play 스토어 안내)</Label>
            <Input value={form.min_native_version} onChange={e => setForm({ ...form, min_native_version: e.target.value })} placeholder="1.1.1 또는 versionCode 470" />
            <p className="text-[11px] text-muted-foreground mt-1">
              폰의 versionName 또는 versionCode가 이 값보다 낮으면 Play 스토어로 보냅니다. 비우면 안내 없음.
            </p>
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
                <tr><th className="py-2">버전</th><th>채널</th><th>필수</th><th>네이티브 최소</th><th>게시일</th><th>노트</th><th></th></tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 font-mono">{r.version}</td>
                    <td><Badge variant={r.channel === "stable" ? "default" : "secondary"}>{r.channel}</Badge></td>
                    <td>{r.mandatory ? <Badge variant="destructive">필수</Badge> : "-"}</td>
                    <td className="font-mono text-xs">{r.min_native_version || "미설정"}</td>
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
