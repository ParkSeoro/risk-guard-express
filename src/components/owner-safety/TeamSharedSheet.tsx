import React, { useState, useMemo, useEffect } from 'react';
import { SharedSheetRow } from './types';
import { INITIAL_SHARED_SHEET_ROWS } from './sampleData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table as TableIcon,
  Plus,
  Search,
  ExternalLink,
  Download,
  Trash2,
  Edit2,
  FolderOpen,
  Link as LinkIcon,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'safenex_owner_shared_sheet';
const EXTERNAL_URL_KEY = 'safenex_owner_shared_folder_url';
export const DEFAULT_SHARED_FOLDER_URL = 'https://drive.google.com/drive/folders/1xlkvYU3mU_KaVqqonglh3T4EGkIE38OT?usp=sharing';

export function TeamSharedSheet() {
  const { user, profile, hasRole } = useAuth();
  const isFolderAdmin =
    hasRole('master') ||
    user?.email === 'seoro.park@airliquide.com' ||
    user?.email === 'psr1579@gmail.com' ||
    (profile?.display_name || '').includes('박서로');

  const [rows, setRows] = useState<SharedSheetRow[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return INITIAL_SHARED_SHEET_ROWS;
  });

  const [externalUrl, setExternalUrl] = useState<string>(() => {
    return localStorage.getItem(EXTERNAL_URL_KEY) || DEFAULT_SHARED_FOLDER_URL;
  });

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<SharedSheetRow | null>(null);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [tempUrl, setTempUrl] = useState('');

  const [form, setForm] = useState({
    category: '공문/인허가' as SharedSheetRow['category'],
    title: '',
    details: '',
    assignee: '박서로 차장',
    status: '진행중' as SharedSheetRow['status'],
    link_url: '',
    notes: '',
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {
      /* ignore */
    }
  }, [rows]);

  const openCreateModal = () => {
    setEditingRow(null);
    setForm({
      category: '공문/인허가',
      title: '',
      details: '',
      assignee: '박서로 차장',
      status: '진행중',
      link_url: '',
      notes: '',
    });
    setDialogOpen(true);
  };

  const openEditModal = (row: SharedSheetRow) => {
    setEditingRow(row);
    setForm({
      category: row.category,
      title: row.title,
      details: row.details,
      assignee: row.assignee,
      status: row.status,
      link_url: row.link_url || '',
      notes: row.notes || '',
    });
    setDialogOpen(true);
  };

  const handleSaveRow = () => {
    if (!form.title.trim()) {
      toast.error('관리 항목명을 입력해주세요.');
      return;
    }

    const now = new Date();
    const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (editingRow) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === editingRow.id
            ? {
                ...r,
                category: form.category,
                title: form.title.trim(),
                details: form.details,
                assignee: form.assignee,
                updated_by: '박서로 차장',
                updated_at: formattedDate,
                status: form.status,
                link_url: form.link_url,
                notes: form.notes,
              }
            : r
        )
      );
      toast.success('항목이 수정되었습니다.');
    } else {
      const newRow: SharedSheetRow = {
        id: `sheet-${Date.now()}`,
        category: form.category,
        title: form.title.trim(),
        details: form.details,
        assignee: form.assignee,
        updated_by: '박서로 차장',
        updated_at: formattedDate,
        status: form.status,
        link_url: form.link_url,
        notes: form.notes,
      };
      setRows((prev) => [newRow, ...prev]);
      toast.success('새 항목이 등록되었습니다.');
    }

    setDialogOpen(false);
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`[${title}] 항목을 삭제하시겠습니까?`)) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success('항목이 삭제되었습니다.');
  };

  const saveExternalUrl = () => {
    localStorage.setItem(EXTERNAL_URL_KEY, tempUrl);
    setExternalUrl(tempUrl);
    setUrlModalOpen(false);
    toast.success('공유폴더(스프레드시트) 링크가 저장되었습니다.');
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q && !`${r.title} ${r.details} ${r.assignee} ${r.notes}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, categoryFilter, statusFilter]);

  const handleExportCSV = () => {
    const headers = ['No', '구분', '관리항목명', '세부내용 및 추진현황', '담당자', '최종수정', '수정일시', '상태', '비고'];
    const dataRows = filteredRows.map((r, i) => [
      `"${i + 1}"`,
      `"${r.category}"`,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${r.details.replace(/"/g, '""')}"`,
      `"${r.assignee}"`,
      `"${r.updated_by}"`,
      `"${r.updated_at}"`,
      `"${r.status}"`,
      `"${(r.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...dataRows.map((d) => d.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `건설안전팀_공유시트_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('공유 시트 데이터가 CSV로 다운로드되었습니다.');
  };

  const statusBadge = (status: SharedSheetRow['status']) => {
    switch (status) {
      case '완료':
        return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px]">완료</Badge>;
      case '진행중':
        return <Badge className="bg-blue-600 hover:bg-blue-600 text-white text-[10px]">진행중</Badge>;
      case '검토대기':
        return <Badge className="bg-amber-600 hover:bg-amber-600 text-white text-[10px]">검토대기</Badge>;
      case '보류':
      default:
        return <Badge variant="secondary" className="text-[10px]">보류</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner with Dedicated Google Cloud Shared Folder */}
      <Card className="bg-muted/40 border">
        <CardContent className="p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-600/10 text-blue-600 flex items-center justify-center shrink-0">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                건설안전팀 전용 구글 클라우드 공유 폴더
              </h4>
              <p className="text-xs text-muted-foreground">
                팀원 누구나 자유롭게 안전 문서·사진·도면을 업로드/수정/삭제할 수 있는 전용 클라우드 공간입니다. (공유폴더 스프레드시트 실시간 동시 수정)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-sm transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" /> 건설안전팀 전용 구글 드라이브 열기
            </a>

            {/* 폴더 링크 수정은 박서로 차장님 본인(관리자)에게만 표시 */}
            {isFolderAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTempUrl(externalUrl);
                  setUrlModalOpen(true);
                }}
                className="h-8 text-xs gap-1 border-dashed"
                title="공유 폴더 링크 변경 (박서로 차장 전용)"
              >
                <LinkIcon className="h-3.5 w-3.5" /> 폴더 경로 설정
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Grid Card */}
      <Card>
        <CardHeader className="p-4 pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <TableIcon className="h-4 w-4 text-primary" />
              팀 안전 관리 협업 데이터 시트 ({filteredRows.length}개 항목)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              인허가, 관리비, 협력사평가, 점검 일정 등 팀내 공유 항목 실시간 편집
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-8 text-xs gap-1">
              <Download className="h-3.5 w-3.5" /> 엑셀(CSV) 내보내기
            </Button>
            <Button size="sm" onClick={openCreateModal} className="h-8 text-xs gap-1.5">
              <Plus className="h-3.5 w-3.5" /> 행(항목) 추가
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-4 pt-0 space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
              <Input
                placeholder="항목명, 세부 내용, 담당자 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="카테고리" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 구분</SelectItem>
                <SelectItem value="공문/인허가">공문/인허가</SelectItem>
                <SelectItem value="안전보건관리비">안전보건관리비</SelectItem>
                <SelectItem value="협력사평가">협력사평가</SelectItem>
                <SelectItem value="장비/점검">장비/점검</SelectItem>
                <SelectItem value="교육/자격">교육/자격</SelectItem>
                <SelectItem value="기타">기타</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="진행상태" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="진행중">진행중</SelectItem>
                <SelectItem value="검토대기">검토대기</SelectItem>
                <SelectItem value="완료">완료</SelectItem>
                <SelectItem value="보류">보류</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Collaborative Grid Table */}
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/60 text-muted-foreground font-medium">
                <tr className="border-b">
                  <th className="p-2.5 w-12 text-center">No</th>
                  <th className="p-2.5 w-24">구분</th>
                  <th className="p-2.5 min-w-[200px]">관리 항목명</th>
                  <th className="p-2.5 min-w-[320px]">세부 내용 및 추진 현황</th>
                  <th className="p-2.5 w-24">담당자</th>
                  <th className="p-2.5 w-28">최근 갱신</th>
                  <th className="p-2.5 w-20 text-center">상태</th>
                  <th className="p-2.5 w-16 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      일치하는 데이터 항목이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-2.5 text-center text-muted-foreground">{idx + 1}</td>
                      <td className="p-2.5">
                        <Badge variant="outline" className="text-[10px] py-0">
                          {row.category}
                        </Badge>
                      </td>
                      <td className="p-2.5 font-semibold text-slate-900 dark:text-slate-100">
                        <button
                          type="button"
                          onClick={() => openEditModal(row)}
                          className="hover:underline text-left"
                        >
                          {row.title}
                        </button>
                      </td>
                      <td className="p-2.5 text-muted-foreground leading-relaxed">
                        <p className="line-clamp-2" title={row.details}>
                          {row.details}
                        </p>
                        {row.notes && (
                          <span className="text-[11px] text-primary/80 block mt-0.5">
                            ※ {row.notes}
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 whitespace-nowrap font-medium">{row.assignee}</td>
                      <td className="p-2.5 text-muted-foreground whitespace-nowrap text-[11px]">
                        <div>{row.updated_by}</div>
                        <div className="text-[10px] text-muted-foreground/80">{row.updated_at}</div>
                      </td>
                      <td className="p-2.5 text-center whitespace-nowrap">{statusBadge(row.status)}</td>
                      <td className="p-2.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(row)}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(row.id, row.title)}
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add / Edit Row Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {editingRow ? '공유 시트 항목 수정' : '새 항목 등록'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3.5 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">구분 (카테고리)</Label>
                <Select
                  value={form.category}
                  onValueChange={(v: any) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="공문/인허가">공문/인허가</SelectItem>
                    <SelectItem value="안전보건관리비">안전보건관리비</SelectItem>
                    <SelectItem value="협력사평가">협력사평가</SelectItem>
                    <SelectItem value="장비/점검">장비/점검</SelectItem>
                    <SelectItem value="교육/자격">교육/자격</SelectItem>
                    <SelectItem value="기타">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">진행 상태</Label>
                <Select
                  value={form.status}
                  onValueChange={(v: any) => setForm({ ...form, status: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="진행중">진행중</SelectItem>
                    <SelectItem value="검토대기">검토대기</SelectItem>
                    <SelectItem value="완료">완료</SelectItem>
                    <SelectItem value="보류">보류</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">관리 항목명 *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="예: 2026년 3분기 산업안전보건관리비 집행 실적 대조"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">세부 내용 및 추진 현황</Label>
              <Textarea
                rows={3}
                value={form.details}
                onChange={(e) => setForm({ ...form, details: e.target.value })}
                placeholder="추진 내용, 수치, 확인 사항 등을 입력하세요."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">담당자</Label>
                <Input
                  value={form.assignee}
                  onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                  placeholder="예: 박서로 차장"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">관련 문서 / 파일 URL 링크 (선택)</Label>
                <Input
                  value={form.link_url}
                  onChange={(e) => setForm({ ...form, link_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">비고 / 메모</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="특이사항 또는 후속 조치 필요사항"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSaveRow}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* External Folder URL Modal */}
      <Dialog open={urlModalOpen} onOpenChange={setUrlModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-primary" />
              팀 공유폴더 / 스프레드시트 링크 설정
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              차장님의 개인 구글 클라우드 드라이브 또는 안전팀 전용 구글 시트 링크를 입력해 두시면 상단 버튼으로 즉시 이동합니다.
            </p>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">구글 드라이브 / 스프레드시트 URL</Label>
              <Input
                value={tempUrl}
                onChange={(e) => setTempUrl(e.target.value)}
                placeholder="https://drive.google.com/drive/my-drive"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-[11px] h-7"
                onClick={() => setTempUrl(DEFAULT_SHARED_FOLDER_URL)}
              >
                기본 안전팀 폴더로 복원
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setUrlModalOpen(false)}>
              취소
            </Button>
            <Button onClick={saveExternalUrl}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TeamSharedSheet;
