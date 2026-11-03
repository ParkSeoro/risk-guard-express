import React, { useState } from 'react';
import { OfficialLetter } from './types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Inbox,
  FileCheck,
  Calendar,
  Building,
  UserCheck,
  Paperclip,
  Clock,
  Send,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { differenceInCalendarDays, startOfDay } from 'date-fns';

interface Props {
  letter: OfficialLetter | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (letter: OfficialLetter) => void;
  existingOutgoingLetters?: OfficialLetter[];
  onRequestReplyDraft?: (receivedLetter: OfficialLetter) => void;
}

export function ReceivedLetterModal({
  letter,
  isOpen,
  onClose,
  onSave,
  existingOutgoingLetters = [],
  onRequestReplyDraft,
}: Props) {
  const isEditing = Boolean(letter?.id && letter.direction === '수신');

  const todayStr = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<Partial<OfficialLetter>>(() => {
    if (letter) return { ...letter };
    return {
      direction: '수신',
      doc_number: 'ALK-REC-26-01호',
      received_at: todayStr,
      dispatch_date: todayStr.replace(/-/g, '. ') + '.',
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
    };
  });

  // Keep form in sync when letter prop changes
  React.useEffect(() => {
    if (letter) {
      setForm({ ...letter });
    }
  }, [letter]);

  const calculateDDay = (dueStr?: string) => {
    if (!dueStr) return null;
    const diff = differenceInCalendarDays(new Date(dueStr), startOfDay(new Date()));
    if (diff < 0) return <Badge variant="destructive" className="text-[10px]">D+{Math.abs(diff)} 기한 초과</Badge>;
    if (diff === 0) return <Badge className="bg-orange-500 hover:bg-orange-500 text-white text-[10px]">D-Day 오늘 마감</Badge>;
    if (diff <= 3) return <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">D-{diff} 마감 임박</Badge>;
    return <Badge variant="outline" className="text-muted-foreground text-[10px]">D-{diff}</Badge>;
  };

  const handleSave = () => {
    if (!form.subject?.trim()) {
      toast.error('수신 공문 제목을 입력해주세요.');
      return;
    }
    if (!form.sender_organization?.trim()) {
      toast.error('발신 기관/회사명을 입력해주세요.');
      return;
    }

    const payload: OfficialLetter = {
      id: form.id || `letter-rec-${Date.now()}`,
      direction: '수신',
      doc_number: form.doc_number || 'ALK-REC-26-01호',
      dispatch_date: form.received_at ? form.received_at.replace(/-/g, '. ') + '.' : todayStr.replace(/-/g, '. ') + '.',
      received_at: form.received_at || todayStr,
      sender_organization: form.sender_organization.trim(),
      original_doc_number: form.original_doc_number?.trim() || '',
      sender: form.sender?.trim() || form.sender_organization.trim(),
      recipient: form.recipient?.trim() || '에어리퀴드코리아(유) 건설안전팀',
      reference: form.reference?.trim() || '기술본부 CM팀',
      subject: form.subject.trim(),
      handling_assignee: form.handling_assignee?.trim() || '박서로 차장',
      handling_due_date: form.handling_due_date || '',
      handling_status: form.handling_status || '접수',
      status: (form.handling_status === '처리완료' ? '처리완료' : form.handling_status === '조치/회신중' ? '조치중' : '접수완료') as any,
      action_taken: form.action_taken || '',
      reply_doc_number: form.reply_doc_number || '',
      attachment_name: form.attachment_name || '',
      attachment_url: form.attachment_url || '',
      notes: form.notes || '',
      created_at: form.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    onSave(payload);
    onClose();
  };

  const handleQuickCompleteSave = () => {
    if (!form.subject?.trim()) {
      toast.error('수신 공문 제목을 입력해주세요.');
      return;
    }
    if (!form.sender_organization?.trim()) {
      toast.error('발신 기관/회사명을 입력해주세요.');
      return;
    }

    const payload: OfficialLetter = {
      id: form.id || `letter-rec-${Date.now()}`,
      direction: '수신',
      doc_number: form.doc_number || 'ALK-REC-26-01호',
      dispatch_date: form.received_at ? form.received_at.replace(/-/g, '. ') + '.' : todayStr.replace(/-/g, '. ') + '.',
      received_at: form.received_at || todayStr,
      sender_organization: form.sender_organization.trim(),
      original_doc_number: form.original_doc_number?.trim() || '',
      sender: form.sender?.trim() || form.sender_organization.trim(),
      recipient: form.recipient?.trim() || '에어리퀴드코리아(유) 건설안전팀',
      reference: form.reference?.trim() || '기술본부 CM팀',
      subject: form.subject.trim(),
      handling_assignee: form.handling_assignee?.trim() || '박서로 차장',
      handling_due_date: form.handling_due_date || '',
      handling_status: '처리완료',
      status: '처리완료',
      action_taken: form.action_taken || '현장 조치 및 검토 완료',
      reply_doc_number: form.reply_doc_number || '',
      attachment_name: form.attachment_name || '',
      attachment_url: form.attachment_url || '',
      notes: form.notes || '',
      created_at: form.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    onSave(payload);
    toast.success('수신 공문이 [처리완료] 상태로 저장되었습니다.');
    onClose();
  };

  const handleReplyDraftClick = () => {
    if (onRequestReplyDraft && form.subject) {
      onClose();
      onRequestReplyDraft(form as OfficialLetter);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Inbox className="h-5 w-5 text-blue-600" />
              {isEditing ? '수신 공문 상세 및 조치·회신 처리' : '외부 수신 공문 신규 접수 등록'}
            </DialogTitle>
            <Badge variant="outline" className="font-mono text-xs text-blue-700 bg-blue-50 border-blue-200">
              {form.doc_number}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1 text-xs">
          {/* Section 1: Received Meta */}
          <div className="bg-muted/40 p-3.5 rounded-lg border space-y-3">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Building className="h-4 w-4 text-primary" /> 1. 공문 수신 및 발신처 정보
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px]">내부 접수번호</Label>
                <Input
                  className="h-8 font-mono"
                  value={form.doc_number || ''}
                  onChange={(e) => setForm({ ...form, doc_number: e.target.value })}
                  placeholder="ALK-REC-26-01호"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">접수 일자</Label>
                <Input
                  type="date"
                  className="h-8"
                  value={form.received_at || ''}
                  onChange={(e) => setForm({ ...form, received_at: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">발신 기관/회사명 *</Label>
                <Input
                  className="h-8"
                  value={form.sender_organization || ''}
                  onChange={(e) => setForm({ ...form, sender_organization: e.target.value })}
                  placeholder="예: 고용노동부 여수지청, 현대건설"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px]">상대방 원 문서번호</Label>
                <Input
                  className="h-8 font-mono"
                  value={form.original_doc_number || ''}
                  onChange={(e) => setForm({ ...form, original_doc_number: e.target.value })}
                  placeholder="예: 여수-산재-2026-482호"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">발신자 명의</Label>
                <Input
                  className="h-8"
                  value={form.sender || ''}
                  onChange={(e) => setForm({ ...form, sender: e.target.value })}
                  placeholder="예: 고용노동부 여수지청장, 현장소장"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                공문 제목 (件) *
              </Label>
              <Input
                className="h-8 font-medium"
                value={form.subject || ''}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="수신된 공문 제목을 입력하세요."
              />
            </div>
          </div>

          {/* Section 2: Action & Assignment */}
          <div className="bg-muted/40 p-3.5 rounded-lg border space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <UserCheck className="h-4 w-4 text-indigo-600" /> 2. 담당자 지정 및 조치·기한 관리
              </h4>
              {calculateDDay(form.handling_due_date)}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px]">담당 안전관리자</Label>
                <Input
                  className="h-8"
                  value={form.handling_assignee || ''}
                  onChange={(e) => setForm({ ...form, handling_assignee: e.target.value })}
                  placeholder="박서로 차장"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">조치/회신 마감일자</Label>
                <Input
                  type="date"
                  className="h-8"
                  value={form.handling_due_date || ''}
                  onChange={(e) => setForm({ ...form, handling_due_date: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">처리 진행 상태</Label>
                <Select
                  value={form.handling_status || '접수'}
                  onValueChange={(v: any) => setForm({ ...form, handling_status: v })}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="접수">접수 완료</SelectItem>
                    <SelectItem value="담당자배정">담당자 배정</SelectItem>
                    <SelectItem value="조치/회신중">조치 및 회신 진행중</SelectItem>
                    <SelectItem value="처리완료">현장 조치/회신 완료</SelectItem>
                    <SelectItem value="단순공람">단순 공람 종결</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px]">현장 조치 내용 및 이행 결과</Label>
              <Textarea
                rows={3}
                value={form.action_taken || ''}
                onChange={(e) => setForm({ ...form, action_taken: e.target.value })}
                placeholder="지적사항 시정 결과, 점검표 제출 내역, 원청/협력사 전파 내용 등을 기록하세요."
              />
            </div>
          </div>

          {/* Section 3: Attachment & Reply Link */}
          <div className="bg-muted/40 p-3.5 rounded-lg border space-y-3">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Paperclip className="h-4 w-4 text-emerald-600" /> 3. 공문 원본 첨부 및 회신 공문 연계
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px]">수신 공문 원본 파일명</Label>
                <Input
                  className="h-8"
                  value={form.attachment_name || ''}
                  onChange={(e) => setForm({ ...form, attachment_name: e.target.value })}
                  placeholder="예: 2026_취약시기_감독점검표.pdf"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">파일 다운로드 / 구글 드라이브 링크</Label>
                <Input
                  className="h-8"
                  value={form.attachment_url || ''}
                  onChange={(e) => setForm({ ...form, attachment_url: e.target.value })}
                  placeholder="https://drive.google.com/..."
                />
              </div>
            </div>

            <div className="space-y-1 pt-1 border-t">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold">회신 발신 공문 연계 (선택)</Label>
                {onRequestReplyDraft && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] gap-1 text-primary border-primary/30"
                    onClick={handleReplyDraftClick}
                  >
                    <Send className="h-3 w-3" /> 이 공문에 대한 회신 공문 즉시 기안하기
                  </Button>
                )}
              </div>

              <div className="flex gap-2">
                <Input
                  className="h-8 font-mono text-xs flex-1"
                  value={form.reply_doc_number || ''}
                  onChange={(e) => setForm({ ...form, reply_doc_number: e.target.value })}
                  placeholder="예: ALK Technology - Construction Safety - 26-02호"
                />
                {existingOutgoingLetters.length > 0 && (
                  <Select onValueChange={(v) => setForm({ ...form, reply_doc_number: v })}>
                    <SelectTrigger className="w-36 h-8 text-[11px]">
                      <SelectValue placeholder="발신공문 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {existingOutgoingLetters.map((out) => (
                        <SelectItem key={out.id} value={out.doc_number}>
                          {out.doc_number} ({out.subject.slice(0, 15)}...)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px]">특이사항 및 비고</Label>
              <Input
                className="h-8"
                value={form.notes || ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="감독관 입회 일정, 관련 부서 공유 사항 등"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap sm:flex-nowrap justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">
            취소
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleQuickCompleteSave}
              className="h-8 text-xs gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              현장 조치 완료로 즉시 종결
            </Button>
            <Button size="sm" onClick={handleSave} className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {isEditing ? '조치 내역 저장' : '수신 공문 접수 등록'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReceivedLetterModal;
