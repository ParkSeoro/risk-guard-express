import React, { useState, useMemo, useEffect, useRef } from 'react';
import { OfficialLetter } from './types';
import { OfficialLetterEditor } from './OfficialLetterEditor';
import { ReceivedLetterModal } from './ReceivedLetterModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FileText,
  Plus,
  Search,
  Download,
  Trash2,
  Edit3,
  CheckCircle2,
  Clock,
  Send,
  Inbox,
  Sparkles,
  Paperclip,
  ArrowDownLeft,
  ArrowUpRight,
  AlertCircle,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { differenceInCalendarDays, startOfDay } from 'date-fns';
import { nextSerialDocNumber, parseOfficialLetterText } from '@/lib/officialLetterOcr';
import { prepareOfficialLetterFile } from '@/lib/officialLetterFile';
import {
  deleteOwnerLetter,
  loadOwnerLetters,
  readOfficialLetterImage,
  saveOwnerLetter,
  uploadOfficialLetterFile,
} from '@/lib/ownerOfficialLetters';

export function OfficialLetterRegistry({ projectId }: { projectId?: string | null }) {
  const [letters, setLetters] = useState<OfficialLetter[]>([]);
  const [lettersReady, setLettersReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | '발신' | '수신'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingLetter, setEditingLetter] = useState<OfficialLetter | null>(null);

  // Received letter modal state
  const [receivedModalOpen, setReceivedModalOpen] = useState(false);
  const [selectedReceivedLetter, setSelectedReceivedLetter] = useState<OfficialLetter | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOwnerLetters()
      .then((rows) => {
        if (!cancelled) setLetters(rows);
      })
      .catch((error: Error) => {
        if (!cancelled) toast.error(error.message || '공문 대장을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLettersReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const generateNextDocNumber = (): string =>
    nextSerialDocNumber(letters.map((letter) => letter.doc_number), 'outgoing');

  const generateNextRecDocNumber = (): string =>
    nextSerialDocNumber(letters.map((letter) => letter.doc_number), 'received');

  const handleCreateNewOutgoing = () => {
    const today = new Date();
    const formattedDate = `${today.getFullYear()}. ${String(today.getMonth() + 1).padStart(2, '0')}. ${String(today.getDate()).padStart(2, '0')}.`;
    const nextNumber = generateNextDocNumber();

    const newLetter: OfficialLetter = {
      id: `letter-${Date.now()}`,
      project_id: projectId || undefined,
      doc_number: nextNumber,
      direction: '발신',
      dispatch_date: formattedDate,
      recipient: '',
      reference: '',
      sender: '',
      sender_department: '에어리퀴드코리아 기술본부 건설안전팀',
      sender_title: '차장',
      sender_name: '박 서 로',
      subject: '',
      content_paragraphs: [
        '귀 사의 무궁한 발전과 건설 현장의 무재해를 기원합니다.',
      ],
      sub_items_title: '- 아 래 -',
      sub_items: [
        {
          label: '가. 일 정',
          text: '2026년 00월 00일',
        },
        {
          label: '나. 장 소',
          text: 'GSC 여수 H2/LCO2 PJT 현장',
        },
      ],
      status: '작성중',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setEditingLetter(newLetter);
  };

  const handleOpenNewReceived = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const nextNumber = generateNextRecDocNumber();

    const newRecLetter: OfficialLetter = {
      id: `letter-rec-${Date.now()}`,
      project_id: projectId || undefined,
      direction: '수신',
      doc_number: nextNumber,
      dispatch_date: todayStr.replace(/-/g, '. ') + '.',
      received_at: todayStr,
      sender_organization: '',
      original_doc_number: '',
      sender: '',
      recipient: '에어리퀴드코리아(유) 건설안전팀',
      reference: '기술본부 CM팀',
      subject: '',
      handling_assignee: '박서로 차장',
      handling_due_date: '',
      handling_status: '접수',
      status: '접수완료',
      action_taken: '',
      reply_doc_number: '',
      attachment_name: '',
      attachment_url: '',
      notes: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setSelectedReceivedLetter(newRecLetter);
    setReceivedModalOpen(true);
  };

  const handleSaveLetter = async (updated: OfficialLetter) => {
    const saved = await saveOwnerLetter({ ...updated, project_id: updated.project_id || projectId || undefined });
    setLetters((prev) => {
      const idx = prev.findIndex((l) => l.id === saved.id || l.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    setEditingLetter(null);
    setReceivedModalOpen(false);
    setSelectedReceivedLetter(null);
  };

  const handleSaveReceivedLetter = async (updated: OfficialLetter) => {
    const saved = await saveOwnerLetter({ ...updated, project_id: updated.project_id || projectId || undefined });
    setLetters((prev) => {
      const idx = prev.findIndex((l) => l.id === saved.id || l.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
  };

  const handleUpdateLetterStatus = async (letterId: string, newStatus: string) => {
    const current = letters.find((l) => l.id === letterId);
    if (!current) return;
    const nextLetter: OfficialLetter = current.direction === '수신'
      ? {
          ...current,
          handling_status: newStatus as OfficialLetter['handling_status'],
          status: (newStatus === '처리완료' ? '처리완료' : newStatus === '조치/회신중' ? '조치중' : '접수완료') as OfficialLetter['status'],
          updated_at: new Date().toISOString(),
        }
      : {
          ...current,
          status: newStatus as OfficialLetter['status'],
          updated_at: new Date().toISOString(),
        };
    try {
      const saved = await saveOwnerLetter(nextLetter);
      setLetters((prev) => prev.map((l) => (l.id === letterId ? saved : l)));
      toast.success(`진행 상태가 [${newStatus}]로 변경되었습니다.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '상태를 저장하지 못했습니다.');
    }
  };

  const handleQuickComplete = (letter: OfficialLetter) => {
    if (letter.direction === '수신') {
      handleUpdateLetterStatus(letter.id, '처리완료');
    } else {
      handleUpdateLetterStatus(letter.id, '발송완료');
    }
  };

  // Immediate reply draft generation from a received letter
  const handleRequestReplyDraft = (receivedLetter: OfficialLetter) => {
    const today = new Date();
    const formattedDate = `${today.getFullYear()}. ${String(today.getMonth() + 1).padStart(2, '0')}. ${String(today.getDate()).padStart(2, '0')}.`;
    const nextNumber = generateNextDocNumber();

    const replyLetter: OfficialLetter = {
      id: `letter-${Date.now()}`,
      project_id: projectId || receivedLetter.project_id,
      doc_number: nextNumber,
      direction: '발신',
      dispatch_date: formattedDate,
      recipient: receivedLetter.sender_organization || receivedLetter.sender || '',
      reference: '',
      sender: '',
      sender_department: '에어리퀴드코리아 기술본부 건설안전팀',
      sender_title: '차장',
      sender_name: '박 서 로',
      subject: `[회신] ${receivedLetter.subject}`,
      content_paragraphs: [
        '귀 기관(사)의 무궁한 발전과 노고에 감사드립니다.',
        `귀 기관(사)의 공문 [문서번호: ${receivedLetter.original_doc_number || receivedLetter.doc_number}]과 관련하여, 현장 안전관리 조치 및 검토 결과를 아래와 같이 회신합니다.`,
      ],
      sub_items_title: '- 아 래 -',
      sub_items: [
        {
          label: '가. 현장 조치 내용',
          text: receivedLetter.action_taken || '지적 및 권고사항에 대한 현장 이행 완료',
        },
        {
          label: '나. 첨부 증빙 서류',
          text: '현장 개선 전·후 사진대지 및 안전점검 이행확인서 각 1부',
        },
      ],
      status: '작성중',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setEditingLetter(replyLetter);
    toast.info(`수신 공문에 대한 회신 공문(${nextNumber}) 초안이 기안되었습니다.`);
  };

  const handleDelete = async (id: string, docNumber: string) => {
    if (!window.confirm(`[${docNumber}] 공문을 삭제하시겠습니까?`)) return;
    try {
      await deleteOwnerLetter(id);
      setLetters((prev) => prev.filter((l) => l.id !== id));
      toast.success('공문이 삭제되었습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '공문을 삭제하지 못했습니다.');
    }
  };

  const handleUploadOutgoing = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error('15MB 이하 파일만 올릴 수 있습니다.');
      return;
    }
    setUploading(true);
    try {
      const filePath = await uploadOfficialLetterFile(file);
      const prepared = await prepareOfficialLetterFile(file);
      let text = prepared.text;
      let ocrStatus = text ? 'text' : '';
      let confidence: number | null = text ? 0.95 : null;
      let warning = '';
      if (prepared.imageBase64 && prepared.mimeType) {
        const read = await readOfficialLetterImage(prepared.imageBase64, prepared.mimeType);
        text = [text, read.text].filter((part) => part && part.trim()).join('\n');
        ocrStatus = read.status;
        confidence = read.confidence;
        warning = read.warning || '';
      }
      const parsed = parseOfficialLetterText(text);
      if (parsed.docNumber && letters.some((letter) => letter.doc_number === parsed.docNumber)) {
        toast.error(`${parsed.docNumber} 은 이미 대장에 있습니다. 다음 채번은 이 번호를 건너뜁니다.`);
        return;
      }
      const today = new Date();
      const formattedDate = `${today.getFullYear()}. ${String(today.getMonth() + 1).padStart(2, '0')}. ${String(today.getDate()).padStart(2, '0')}.`;
      const uploaded: OfficialLetter = {
        id: `letter-upload-${Date.now()}`,
        project_id: projectId || undefined,
        doc_number: parsed.docNumber || '',
        direction: '발신',
        dispatch_date: parsed.dispatchDate || formattedDate,
        recipient: parsed.recipient,
        reference: parsed.reference,
        sender: '에어리퀴드코리아 기술본부 건설안전팀',
        sender_department: '에어리퀴드코리아 기술본부 건설안전팀',
        sender_title: '차장',
        sender_name: '박 서 로',
        subject: parsed.subject,
        content_paragraphs: parsed.paragraphs.length ? parsed.paragraphs : ['원문에서 읽은 본문을 확인해 주세요.'],
        sub_items_title: '- 아 래 -',
        sub_items: [],
        status: '발송완료',
        source: 'upload',
        attachment_name: file.name,
        file_path: filePath,
        ocr_text: text,
        ocr_status: ocrStatus,
        ocr_confidence: confidence,
        notes: warning || '시스템 밖에서 작성해 발송한 공문입니다.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setEditingLetter(uploaded);
      if (!parsed.docNumber) {
        toast.error('문서번호를 읽지 못했습니다. 원문의 번호를 적어 저장하면 다음 채번에 반영됩니다.');
      } else {
        toast.success(`${parsed.docNumber} 을 읽었습니다. 내용을 확인한 뒤 대장에 등록하세요.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '공문을 읽지 못했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const outgoingLetters = useMemo(() => letters.filter((l) => l.direction === '발신'), [letters]);
  const incomingLetters = useMemo(() => letters.filter((l) => l.direction === '수신'), [letters]);

  const filteredLetters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return letters.filter((l) => {
      if (activeTab !== 'all' && l.direction !== activeTab) return false;
      if (statusFilter !== 'all') {
        if (l.direction === '수신') {
          if (l.handling_status !== statusFilter && l.status !== statusFilter) return false;
        } else {
          if (l.status !== statusFilter) return false;
        }
      }
      if (
        q &&
        !`${l.doc_number} ${l.subject} ${l.recipient} ${l.sender} ${l.sender_organization || ''} ${l.original_doc_number || ''} ${l.reference}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [letters, search, activeTab, statusFilter]);

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      '구분',
      '문서번호',
      '발송/접수일자',
      '발신처(기관)',
      '수신처',
      '원문서번호',
      '공문제목',
      '진행상태/조치현황',
      '담당자',
      '회신공문번호',
    ];
    const rows = filteredLetters.map((l) => [
      `"${l.direction}"`,
      `"${l.doc_number}"`,
      `"${l.dispatch_date || l.received_at || ''}"`,
      `"${(l.sender_organization || l.sender || '').replace(/"/g, '""')}"`,
      `"${(l.recipient || '').replace(/"/g, '""')}"`,
      `"${(l.original_doc_number || '').replace(/"/g, '""')}"`,
      `"${l.subject.replace(/"/g, '""')}"`,
      `"${l.direction === '수신' ? l.handling_status || l.status : l.status}"`,
      `"${l.handling_assignee || l.sender_name || ''}"`,
      `"${l.reply_doc_number || ''}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `건설안전팀_공문수발신대장_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('공문 대장이 CSV 파일로 다운로드되었습니다.');
  };

  if (editingLetter) {
    return (
      <OfficialLetterEditor
        letter={editingLetter}
        onSave={handleSaveLetter}
        onClose={() => setEditingLetter(null)}
      />
    );
  }

  const renderStatusBadge = (letter: OfficialLetter) => {
    if (letter.direction === '수신') {
      const hStatus = letter.handling_status || '접수';
      return (
        <div className="flex items-center justify-center">
          <Select
            value={hStatus}
            onValueChange={(val) => handleUpdateLetterStatus(letter.id, val)}
          >
            <SelectTrigger className="h-6 w-[105px] text-[11px] px-1.5 py-0 border-dashed hover:border-solid bg-transparent">
              <SelectValue>
                {hStatus === '처리완료' ? (
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> 처리완료
                  </span>
                ) : hStatus === '조치/회신중' ? (
                  <span className="text-orange-600 dark:text-orange-400 font-medium flex items-center gap-1">
                    <Clock className="h-3 w-3" /> 조치중
                  </span>
                ) : hStatus === '담당자배정' ? (
                  <span className="text-blue-600 dark:text-blue-400 font-medium">담당자배정</span>
                ) : hStatus === '단순공람' ? (
                  <span className="text-muted-foreground font-medium">단순공람</span>
                ) : (
                  <span className="text-blue-700 dark:text-blue-400 font-medium">신규접수</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="접수">신규 접수</SelectItem>
              <SelectItem value="담당자배정">담당자 배정</SelectItem>
              <SelectItem value="조치/회신중">조치·회신 진행중</SelectItem>
              <SelectItem value="처리완료">현장 조치완료</SelectItem>
              <SelectItem value="단순공람">단순 공람 종결</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    }

    const curStatus = letter.status || '작성중';
    return (
      <div className="flex items-center justify-center">
        <Select
          value={curStatus}
          onValueChange={(val) => handleUpdateLetterStatus(letter.id, val)}
        >
          <SelectTrigger className="h-6 w-[95px] text-[11px] px-1.5 py-0 border-dashed hover:border-solid bg-transparent">
            <SelectValue>
              {curStatus === '발송완료' ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" /> 발송완료
                </span>
              ) : curStatus === '팀장승인' ? (
                <span className="text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" /> 팀장승인
                </span>
              ) : (
                <span className="text-slate-600 dark:text-slate-300 font-medium flex items-center gap-1">
                  <Edit3 className="h-3 w-3" /> 작성중
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="작성중">작성중</SelectItem>
            <SelectItem value="팀장승인">팀장승인 (검토대기)</SelectItem>
            <SelectItem value="발송완료">발송완료</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  };

  const renderDDayBadge = (dueStr?: string) => {
    if (!dueStr) return null;
    const diff = differenceInCalendarDays(new Date(dueStr), startOfDay(new Date()));
    if (diff < 0) {
      return (
        <Badge variant="destructive" className="text-[10px] py-0 px-1.5 whitespace-nowrap">
          D+{Math.abs(diff)} 초과
        </Badge>
      );
    }
    if (diff === 0) {
      return (
        <Badge className="bg-orange-600 hover:bg-orange-600 text-white text-[10px] py-0 px-1.5 whitespace-nowrap">
          오늘 마감
        </Badge>
      );
    }
    if (diff <= 3) {
      return (
        <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px] py-0 px-1.5 whitespace-nowrap">
          D-{diff} 임박
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-muted-foreground text-[10px] py-0 px-1.5 whitespace-nowrap">
        D-{diff}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top statistics summary banner */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card
          className={`cursor-pointer transition-colors border ${activeTab === 'all' ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'}`}
          onClick={() => setActiveTab('all')}
        >
          <CardContent className="p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">전체 수발신 공문</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">{letters.length}건</p>
            </div>
            <FileText className="h-7 w-7 text-primary/50" />
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors border ${activeTab === '발신' ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'}`}
          onClick={() => setActiveTab('발신')}
        >
          <CardContent className="p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <ArrowUpRight className="h-3.5 w-3.5 text-primary" /> 발신 공문 (대외공식)
              </p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <p className="text-2xl font-bold text-primary">{outgoingLetters.length}건</p>
                <span className="text-[11px] text-muted-foreground">
                  (완료 {outgoingLetters.filter((l) => l.status === '발송완료').length})
                </span>
              </div>
            </div>
            <Send className="h-7 w-7 text-primary/40" />
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors border ${activeTab === '수신' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20' : 'hover:bg-muted/30'}`}
          onClick={() => setActiveTab('수신')}
        >
          <CardContent className="p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <ArrowDownLeft className="h-3.5 w-3.5 text-blue-600" /> 수신 공문 (대외접수)
              </p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <p className="text-2xl font-bold text-blue-600">{incomingLetters.length}건</p>
                <span className="text-[11px] text-orange-600 font-semibold">
                  (조치중 {incomingLetters.filter((l) => l.handling_status === '조치/회신중' || l.handling_status === '접수').length})
                </span>
              </div>
            </div>
            <Inbox className="h-7 w-7 text-blue-500/40" />
          </CardContent>
        </Card>

        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardContent className="p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">다음 공식 발신 채번</p>
              <p className="text-xs font-mono font-bold text-amber-700 mt-1 truncate" title={lettersReady ? generateNextDocNumber() : ''}>
                {lettersReady ? generateNextDocNumber().replace('ALK Technology - Construction Safety - ', '') : '불러오는 중'}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                수신: {lettersReady ? generateNextRecDocNumber() : '…'}
              </p>
            </div>
            <Sparkles className="h-7 w-7 text-amber-500/40" />
          </CardContent>
        </Card>
      </div>

      {/* Main Registry Card */}
      <Card>
        <CardHeader className="p-4 pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              건설안전팀 공식 공문 수발신 대장
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              에어리퀴드코리아 기술본부 건설안전팀 발신 공문 채번 및 대외 수신 공문 접수·조치·회신 통합 관리
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-8 text-xs gap-1">
              <Download className="h-3.5 w-3.5" /> 엑셀(CSV) 내보내기
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenNewReceived}
              className="h-8 text-xs gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
            >
              <Inbox className="h-3.5 w-3.5" /> 수신 공문 접수 등록
            </Button>

            <input
              ref={uploadRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void handleUploadOutgoing(file);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => uploadRef.current?.click()}
              className="h-8 text-xs gap-1.5"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? '공문 읽는 중' : '시스템 외 발신 공문 올리기'}
            </Button>

            <Button size="sm" onClick={handleCreateNewOutgoing} className="h-8 text-xs gap-1.5">
              <Plus className="h-3.5 w-3.5" /> 새 공문 작성 (발신 자동채번)
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-4 pt-0 space-y-3">
          {/* Tabs & Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-b pb-2.5">
            {/* View Tabs */}
            <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  activeTab === 'all'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                전체 공문 ({letters.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('발신')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeTab === '발신'
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ArrowUpRight className="h-3 w-3" /> 발신 공문 ({outgoingLetters.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('수신')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeTab === '수신'
                    ? 'bg-background text-blue-600 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ArrowDownLeft className="h-3 w-3" /> 수신 공문 ({incomingLetters.length})
              </button>
            </div>

            {/* Search and Status Filter */}
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
                <Input
                  placeholder="문서번호, 제목, 발신처/수신처 검색..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="진행상태" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 상태</SelectItem>
                  <SelectItem value="작성중">작성중</SelectItem>
                  <SelectItem value="팀장승인">팀장승인</SelectItem>
                  <SelectItem value="발송완료">발송완료</SelectItem>
                  <SelectItem value="접수">신규접수</SelectItem>
                  <SelectItem value="조치/회신중">조치/회신중</SelectItem>
                  <SelectItem value="처리완료">처리완료</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Table */}
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/60 text-muted-foreground font-medium">
                <tr className="border-b">
                  <th className="p-2.5 w-14 text-center">구분</th>
                  <th className="p-2.5 min-w-[200px]">문서 번호</th>
                  <th className="p-2.5 min-w-[280px]">공문 제목 (件)</th>
                  <th className="p-2.5 w-36">발신처 / 수신처</th>
                  <th className="p-2.5 w-24">일자</th>
                  <th className="p-2.5 w-24">담당자</th>
                  <th className="p-2.5 w-28 text-center">진행 상태</th>
                  <th className="p-2.5 w-24 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLetters.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      검색 조건에 일치하는 공문 기록이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredLetters.map((letter) => {
                    const isIncoming = letter.direction === '수신';

                    return (
                      <tr key={letter.id} className="hover:bg-muted/40 transition-colors">
                        <td className="p-2.5 text-center">
                          <Badge
                            variant="outline"
                            className={
                              isIncoming
                                ? 'text-blue-700 bg-blue-50 border-blue-200 text-[10px] py-0 font-medium'
                                : 'text-primary bg-primary/5 border-primary/30 text-[10px] py-0 font-medium'
                            }
                          >
                            {letter.direction}
                          </Badge>
                        </td>
                        <td className="p-2.5 font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span>{letter.doc_number}</span>
                            {letter.source === 'upload' && (
                              <Badge variant="outline" className="text-[10px] py-0 font-sans">시스템 외</Badge>
                            )}
                          </div>
                          {isIncoming && letter.original_doc_number && (
                            <div className="text-[10px] text-muted-foreground truncate" title={`원문: ${letter.original_doc_number}`}>
                              원문: {letter.original_doc_number}
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 font-medium">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => {
                                if (isIncoming) {
                                  setSelectedReceivedLetter(letter);
                                  setReceivedModalOpen(true);
                                } else {
                                  setEditingLetter(letter);
                                }
                              }}
                              className="hover:underline text-left text-slate-900 dark:text-slate-100 hover:text-primary transition-colors truncate max-w-[340px]"
                              title={letter.subject}
                            >
                              {letter.subject || '(제목 없음)'}
                            </button>
                            {isIncoming && renderDDayBadge(letter.handling_due_date)}
                            {letter.attachment_name && (
                              <span
                                className="inline-flex items-center text-[10px] text-muted-foreground hover:text-foreground"
                                title={`첨부파일: ${letter.attachment_name}`}
                              >
                                <Paperclip className="h-3 w-3 text-emerald-600" />
                              </span>
                            )}
                          </div>
                          {letter.reply_doc_number && (
                            <div className="text-[10px] text-primary flex items-center gap-1 mt-0.5 font-mono">
                              <ArrowUpRight className="h-3 w-3" /> 회신공문: {letter.reply_doc_number}
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 text-muted-foreground text-[11px]">
                          {isIncoming ? (
                            <div>
                              <div className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[140px]" title={letter.sender_organization || letter.sender}>
                                {letter.sender_organization || letter.sender}
                              </div>
                              <div className="text-[10px] text-muted-foreground">→ 건설안전팀 접수</div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[140px]" title={letter.recipient}>
                                {letter.recipient}
                              </div>
                              <div className="text-[10px] text-muted-foreground">에어리퀴드 건설안전팀 발송</div>
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 text-muted-foreground whitespace-nowrap text-[11px]">
                          {letter.dispatch_date || letter.received_at}
                        </td>
                        <td className="p-2.5 text-muted-foreground whitespace-nowrap text-[11px]">
                          {isIncoming ? letter.handling_assignee || '미지정' : letter.sender_name || '박서로 차장'}
                        </td>
                        <td className="p-2.5 text-center whitespace-nowrap">
                          {renderStatusBadge(letter)}
                        </td>
                        <td className="p-2.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {((isIncoming && letter.handling_status !== '처리완료') ||
                              (!isIncoming && letter.status !== '발송완료')) && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleQuickComplete(letter)}
                                className="h-7 px-2 text-[11px] text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 gap-1 font-medium"
                                title="원클릭 완료 처리"
                              >
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                {isIncoming ? '조치완료' : '발송완료'}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (isIncoming) {
                                  setSelectedReceivedLetter(letter);
                                  setReceivedModalOpen(true);
                                } else {
                                  setEditingLetter(letter);
                                }
                              }}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title={isIncoming ? '수신 공문 조치 및 열람' : '발신 공문 열람 및 수정'}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(letter.id, letter.doc_number)}
                              className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              title="삭제"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Received Letter Action & Management Modal */}
      <ReceivedLetterModal
        letter={selectedReceivedLetter}
        isOpen={receivedModalOpen}
        onClose={() => {
          setReceivedModalOpen(false);
          setSelectedReceivedLetter(null);
        }}
        onSave={handleSaveReceivedLetter}
        existingOutgoingLetters={outgoingLetters}
        onRequestReplyDraft={handleRequestReplyDraft}
      />
    </div>
  );
}

export default OfficialLetterRegistry;
