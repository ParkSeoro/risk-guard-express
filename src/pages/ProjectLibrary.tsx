import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, Download, Trash2, Pencil, Pin, FileText, Loader2, FolderOpen } from 'lucide-react';

interface LibFile {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  category: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  download_count: number;
  is_pinned: boolean;
  created_at: string;
}

const CATEGORIES = [
  { value: 'safety', label: '안전관리' },
  { value: 'quality', label: '품질관리' },
  { value: 'drawing', label: '도면/설계' },
  { value: 'manual', label: '매뉴얼/지침' },
  { value: 'report', label: '보고서/회의록' },
  { value: 'training', label: '교육자료' },
  { value: 'form', label: '서식/양식' },
  { value: 'etc', label: '기타' },
];

const fmtSize = (b: number | null) => {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

export default function ProjectLibrary() {
  const { user, isAdmin, hasRole } = useAuth();
  const { selectedProject, projects, setSelectedProject } = useGlobalProjectAccess();
  const { toast } = useToast();
  const isMaster = hasRole('master');

  const [files, setFiles] = useState<LibFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Upload dialog
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<LibFile | null>(null);
  const [form, setForm] = useState({ title: '', description: '', category: 'etc', file: null as File | null });

  const projectId = selectedProject;
  const canUpload = !!projectId && !!isAdmin;

  const fetchFiles = useCallback(async () => {
    if (!projectId) {
      setFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('project_library_files')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_deleted', false)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: '자료실 조회 실패', description: error.message, variant: 'destructive' });
    }
    setFiles((data as LibFile[]) || []);
    setLoading(false);
  }, [projectId, toast]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const resetForm = () => {
    setForm({ title: '', description: '', category: 'etc', file: null });
    setEditing(null);
  };

  const openUpload = () => { resetForm(); setOpen(true); };
  const openEdit = (f: LibFile) => {
    setEditing(f);
    setForm({ title: f.title, description: f.description || '', category: f.category, file: null });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!projectId || !user) return;
    if (!form.title.trim()) {
      toast({ title: '제목을 입력하세요.', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from('project_library_files')
          .update({ title: form.title.trim(), description: form.description.trim() || null, category: form.category })
          .eq('id', editing.id);
        if (error) throw error;
        toast({ title: '수정되었습니다.' });
      } else {
        if (!form.file) {
          toast({ title: '파일을 선택하세요.', variant: 'destructive' });
          setUploading(false);
          return;
        }
        const ext = form.file.name.split('.').pop() || 'bin';
        const path = `${projectId}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('project-library').upload(path, form.file, {
          contentType: form.file.type || undefined,
        });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from('project_library_files').insert({
          project_id: projectId,
          title: form.title.trim(),
          description: form.description.trim() || null,
          category: form.category,
          file_path: path,
          file_name: form.file.name,
          file_size: form.file.size,
          mime_type: form.file.type || null,
          uploaded_by: user.id,
          uploaded_by_name: (user.user_metadata as any)?.display_name || user.email || null,
        });
        if (insErr) {
          await supabase.storage.from('project-library').remove([path]);
          throw insErr;
        }
        toast({ title: '업로드 완료' });
      }
      setOpen(false);
      resetForm();
      fetchFiles();
    } catch (e: any) {
      toast({ title: '저장 실패', description: e.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (f: LibFile) => {
    const { data, error } = await supabase.storage.from('project-library').createSignedUrl(f.file_path, 60);
    if (error || !data) {
      toast({ title: '다운로드 링크 생성 실패', variant: 'destructive' });
      return;
    }
    await supabase.from('project_library_files').update({ download_count: f.download_count + 1 }).eq('id', f.id);
    window.open(data.signedUrl, '_blank');
  };

  const handleDelete = async (f: LibFile) => {
    if (!confirm(`'${f.title}' 자료를 삭제하시겠습니까?`)) return;
    const { error } = await supabase
      .from('project_library_files')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: user?.id })
      .eq('id', f.id);
    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
      return;
    }
    await supabase.storage.from('project-library').remove([f.file_path]);
    toast({ title: '삭제되었습니다.' });
    fetchFiles();
  };

  const togglePin = async (f: LibFile) => {
    await supabase.from('project_library_files').update({ is_pinned: !f.is_pinned }).eq('id', f.id);
    fetchFiles();
  };

  const canEditOrDelete = (f: LibFile) => isMaster || f.uploaded_by === user?.id;

  const filtered = files.filter(f => {
    if (filter !== 'all' && f.category !== filter) return false;
    if (search && !`${f.title} ${f.description || ''} ${f.file_name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-primary" /> 공개 자료실
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">프로젝트 멤버에게 공유되는 파일 자료실 (관리자만 업로드)</p>
        </div>
        {canUpload && (
          <Button onClick={openUpload} className="gap-1.5">
            <Upload className="h-4 w-4" /> 자료 업로드
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select
              value={projectId || ''}
              onValueChange={v => setSelectedProject(v)}
            >

              <SelectTrigger className="w-[240px] h-9"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 카테고리</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="제목/설명/파일명 검색" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs h-9" />
            <div className="ml-auto text-xs text-muted-foreground">총 {filtered.length}건</div>
          </div>
        </CardHeader>
        <CardContent>
          {!projectId ? (
            <div className="py-12 text-center text-sm text-muted-foreground">먼저 프로젝트를 선택하세요.</div>
          ) : loading ? (
            <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {canUpload ? '아직 업로드된 자료가 없습니다. 우측 상단에서 업로드해 보세요.' : '아직 업로드된 자료가 없습니다.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map(f => (
                <Card key={f.id} className={`p-3 ${f.is_pinned ? 'border-primary/40 bg-primary/5' : ''}`}>
                  <div className="flex items-start gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">{CATEGORIES.find(c => c.value === f.category)?.label || f.category}</Badge>
                        {f.is_pinned && <Badge className="text-[10px] bg-primary">고정</Badge>}
                      </div>
                      <div className="font-medium text-sm mt-1 truncate" title={f.title}>{f.title}</div>
                      {f.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{f.description}</div>}
                      <div className="text-[11px] text-muted-foreground mt-1 truncate" title={f.file_name}>
                        📎 {f.file_name} · {fmtSize(f.file_size)}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {f.uploaded_by_name || '—'} · {new Date(f.created_at).toLocaleDateString('ko-KR')} · ⬇ {f.download_count}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t">
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => handleDownload(f)}>
                      <Download className="h-3.5 w-3.5" /> 다운로드
                    </Button>
                    {isMaster && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => togglePin(f)} title="고정/해제">
                        <Pin className={`h-3.5 w-3.5 ${f.is_pinned ? 'text-primary' : ''}`} />
                      </Button>
                    )}
                    {canEditOrDelete(f) && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(f)} title="수정">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(f)} title="삭제">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? '자료 수정' : '자료 업로드'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">제목 *</label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="자료 제목" />
            </div>
            <div>
              <label className="text-xs font-medium">카테고리</label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">설명</label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            {!editing && (
              <div>
                <label className="text-xs font-medium">파일 *</label>
                <Input type="file" onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} />
                {form.file && <div className="text-[11px] text-muted-foreground mt-1">{form.file.name} · {fmtSize(form.file.size)}</div>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={uploading}>취소</Button>
            <Button onClick={handleSave} disabled={uploading}>
              {uploading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editing ? '저장' : '업로드'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
