import React, { useState } from 'react';
import { OfficialLetter } from './types';
import { AirLiquideLogo } from './AirLiquideLogo';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, Save, Plus, Trash2, ArrowLeft, Eye, Edit3, UserCheck, Shield } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  letter: OfficialLetter;
  onSave: (letter: OfficialLetter) => void;
  onClose: () => void;
}

export function OfficialLetterEditor({ letter: initialLetter, onSave, onClose }: Props) {
  const { profile } = useAuth();

  // If new letter and sender fields are generic, default to logged in user / author
  const defaultAuthorName = profile?.display_name || '박 서 로';
  const [letter, setLetter] = useState<OfficialLetter>(() => ({
    ...initialLetter,
    sender_name: initialLetter.sender_name || defaultAuthorName,
    sender_title: initialLetter.sender_title || '차장',
    sender_department: initialLetter.sender_department || '에어리퀴드코리아 기술본부 건설안전팀',
    sender:
      initialLetter.sender ||
      `에어리퀴드코리아 기술본부 건설안전팀 ${defaultAuthorName} ${initialLetter.sender_title || '차장'}`,
  }));

  const [activeView, setActiveView] = useState<'editor' | 'preview'>('preview');

  // Handle paragraph edits
  const handleParagraphChange = (index: number, val: string) => {
    const updated = [...letter.content_paragraphs];
    updated[index] = val;
    setLetter({ ...letter, content_paragraphs: updated });
  };

  const addParagraph = () => {
    setLetter({
      ...letter,
      content_paragraphs: [...letter.content_paragraphs, '새로운 본문 내용을 입력하세요.'],
    });
  };

  const removeParagraph = (index: number) => {
    if (letter.content_paragraphs.length <= 1) {
      toast.error('최소 1개 이상의 본문 단락이 필요합니다.');
      return;
    }
    const updated = letter.content_paragraphs.filter((_, i) => i !== index);
    setLetter({ ...letter, content_paragraphs: updated });
  };

  // Sub-items ("- 아 래 -")
  const handleSubItemChange = (index: number, field: 'label' | 'text', val: string) => {
    const updated = [...letter.sub_items];
    updated[index] = { ...updated[index], [field]: val };
    setLetter({ ...letter, sub_items: updated });
  };

  const addSubBullet = (itemIndex: number) => {
    const updated = [...letter.sub_items];
    const bullets = updated[itemIndex].sub_bullets || [];
    updated[itemIndex].sub_bullets = [...bullets, '세부 사항 항목'];
    setLetter({ ...letter, sub_items: updated });
  };

  const handleSubBulletChange = (itemIndex: number, bulletIndex: number, val: string) => {
    const updated = [...letter.sub_items];
    const bullets = [...(updated[itemIndex].sub_bullets || [])];
    bullets[bulletIndex] = val;
    updated[itemIndex].sub_bullets = bullets;
    setLetter({ ...letter, sub_items: updated });
  };

  const removeSubBullet = (itemIndex: number, bulletIndex: number) => {
    const updated = [...letter.sub_items];
    const bullets = [...(updated[itemIndex].sub_bullets || [])];
    bullets.splice(bulletIndex, 1);
    updated[itemIndex].sub_bullets = bullets;
    setLetter({ ...letter, sub_items: updated });
  };

  const addSubItem = () => {
    const labels = ['가.', '나.', '다.', '라.', '마.', '바.'];
    const nextLabel = `${labels[letter.sub_items.length] || '항.'} 항목명 :`;
    setLetter({
      ...letter,
      sub_items: [...letter.sub_items, { label: nextLabel, text: '상세 내용' }],
    });
  };

  const removeSubItem = (index: number) => {
    const updated = letter.sub_items.filter((_, i) => i !== index);
    setLetter({ ...letter, sub_items: updated });
  };

  // Auto-sync top sender string when bottom signoff fields change
  const handleAuthorNameChange = (name: string) => {
    const cleanName = name.replace(/\s+/g, ' ').trim();
    setLetter((prev) => ({
      ...prev,
      sender_name: name,
      sender: `${prev.sender_department} ${cleanName} ${prev.sender_title}`,
    }));
  };

  const handleAuthorTitleChange = (title: string) => {
    setLetter((prev) => ({
      ...prev,
      sender_title: title,
      sender: `${prev.sender_department} ${prev.sender_name} ${title}`,
    }));
  };

  const handleAuthorDeptChange = (dept: string) => {
    setLetter((prev) => ({
      ...prev,
      sender_department: dept,
      sender: `${dept} ${prev.sender_name} ${prev.sender_title}`,
    }));
  };

  const handleSave = () => {
    if (!letter.subject.trim()) {
      toast.error('공문 제목을 입력해주세요.');
      return;
    }
    if (!letter.doc_number.trim()) {
      toast.error('문서 번호를 입력해주세요.');
      return;
    }
    onSave({
      ...letter,
      updated_at: new Date().toISOString(),
    });
    toast.success('공문이 저장되었습니다.');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Top action toolbar (hidden on print) */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-card border rounded-lg shadow-sm print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> 대장으로 돌아가기
          </Button>
          <div className="h-4 w-[1px] bg-border mx-1" />
          <div className="flex bg-muted p-0.5 rounded-md">
            <Button
              variant={activeView === 'editor' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setActiveView('editor')}
            >
              <Edit3 className="h-3.5 w-3.5" /> 공문 항목 편집
            </Button>
            <Button
              variant={activeView === 'preview' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setActiveView('preview')}
            >
              <Eye className="h-3.5 w-3.5" /> A4 실제 서식 미리보기
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5 border-primary/40 text-primary">
            <Printer className="h-4 w-4" /> A4 인쇄 / PDF 저장
          </Button>
          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Save className="h-4 w-4" /> 저장 및 수발신 대장 등록
          </Button>
        </div>
      </div>

      {/* Editor Form Panel */}
      {activeView === 'editor' && (
        <div className="grid grid-cols-1 gap-4 print:hidden">
          <Card>
            <CardContent className="p-5 space-y-5">
              <div className="border-b pb-3 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-base">공문 기본 정보 및 수발신처</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">에어리퀴드 공식 공문 아웃라인 기준</p>
                </div>
                <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                  {letter.doc_number}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">문서 번호</Label>
                  <Input
                    value={letter.doc_number}
                    onChange={(e) => setLetter({ ...letter, doc_number: e.target.value })}
                    className="font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">형식: ALK Technology - Construction Safety - YY-NN호</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">발송 일자</Label>
                  <Input
                    value={letter.dispatch_date}
                    onChange={(e) => setLetter({ ...letter, dispatch_date: e.target.value })}
                    placeholder="YYYY. MM. DD."
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">문서 구분 및 진행 상태</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={letter.direction}
                      onValueChange={(v: any) => setLetter({ ...letter, direction: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="발신">발신 공문</SelectItem>
                        <SelectItem value="수신">수신 공문</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={letter.status}
                      onValueChange={(v: any) => setLetter({ ...letter, status: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="작성중">작성중</SelectItem>
                        <SelectItem value="팀장승인">팀장승인</SelectItem>
                        <SelectItem value="발송완료">발송완료</SelectItem>
                        <SelectItem value="접수완료">접수완료</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">수신 (수신처)</Label>
                  <Input
                    value={letter.recipient}
                    onChange={(e) => setLetter({ ...letter, recipient: e.target.value })}
                    placeholder="예: 각 사 대표이사"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">참조 (참조 부서/담당자)</Label>
                  <Input
                    value={letter.reference}
                    onChange={(e) => setLetter({ ...letter, reference: e.target.value })}
                    placeholder="예: 에어리퀴드코리아 기술본부 CM팀, 건설안전팀"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">상단 발신처 표시</Label>
                  <Input
                    value={letter.sender}
                    onChange={(e) => setLetter({ ...letter, sender: e.target.value })}
                    placeholder="예: 에어리퀴드코리아 기술본부 건설안전팀 박서로 차장"
                  />
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <Label className="text-xs font-semibold">공문 제목 (件)</Label>
                <Input
                  value={letter.subject}
                  onChange={(e) => setLetter({ ...letter, subject: e.target.value })}
                  placeholder="예: GSC 여수 H2/LCO2 PJT 「안전의 날」 행사 참석 요청의 件"
                  className="font-medium text-sm"
                />
              </div>

              {/* Body paragraphs */}
              <div className="space-y-3 pt-3 border-t">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">본문 개조식 단락 (1항, 2항, 3항...)</Label>
                  <Button variant="outline" size="sm" onClick={addParagraph} className="h-7 text-xs gap-1">
                    <Plus className="h-3 w-3" /> 단락 추가
                  </Button>
                </div>

                {letter.content_paragraphs.map((para, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <span className="text-xs font-bold pt-2.5 w-6 shrink-0">{idx + 1}.</span>
                    <Textarea
                      rows={2}
                      value={para}
                      onChange={(e) => handleParagraphChange(idx, e.target.value)}
                      className="text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeParagraph(idx)}
                      className="h-8 w-8 text-destructive shrink-0 mt-1"
                      title="단락 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Sub items (- 아래 -) */}
              <div className="space-y-3 pt-3 border-t">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold">하위 상세 항목 (- 아 래 -)</Label>
                    <p className="text-[11px] text-muted-foreground">일정, 장소, 식순 등 세부 사항</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={addSubItem} className="h-7 text-xs gap-1">
                    <Plus className="h-3 w-3" /> 항목 추가 (가, 나, 다...)
                  </Button>
                </div>

                {letter.sub_items.map((item, itemIdx) => (
                  <Card key={itemIdx} className="bg-muted/30 border-dashed">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          className="w-24 text-xs font-bold"
                          value={item.label}
                          onChange={(e) => handleSubItemChange(itemIdx, 'label', e.target.value)}
                        />
                        <Input
                          className="flex-1 text-xs"
                          value={item.text}
                          onChange={(e) => handleSubItemChange(itemIdx, 'text', e.target.value)}
                          placeholder="항목 내용 (예: 2026년 7월 30일(목))"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeSubItem(itemIdx)}
                          className="h-7 w-7 text-destructive shrink-0"
                          title="항목 삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {/* Bullets inside sub-item */}
                      <div className="pl-6 space-y-1.5">
                        {(item.sub_bullets || []).map((bullet, bIdx) => (
                          <div key={bIdx} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">•</span>
                            <Input
                              className="h-7 text-xs"
                              value={bullet}
                              onChange={(e) => handleSubBulletChange(itemIdx, bIdx, e.target.value)}
                              placeholder="세부 일정 또는 불릿 내용"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeSubBullet(itemIdx, bIdx)}
                              className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => addSubBullet(itemIdx)}
                          className="h-6 text-[11px] text-muted-foreground gap-1 px-1.5"
                        >
                          <Plus className="h-2.5 w-2.5" /> 세부 불릿(•) 추가
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Editable Signoff Section */}
              <div className="pt-3 border-t space-y-3">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-primary" />
                  <Label className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    하단 공식 서명부 (작성자 기본 셋팅 및 자유 수정 가능)
                  </Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">발신 부서명</Label>
                    <Input
                      value={letter.sender_department}
                      onChange={(e) => handleAuthorDeptChange(e.target.value)}
                      placeholder="에어리퀴드코리아 기술본부 건설안전팀"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">직급</Label>
                    <Input
                      value={letter.sender_title}
                      onChange={(e) => handleAuthorTitleChange(e.target.value)}
                      placeholder="차장"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">성명 (작성자)</Label>
                    <Input
                      value={letter.sender_name}
                      onChange={(e) => handleAuthorNameChange(e.target.value)}
                      placeholder="박 서 로"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  ※ 작성자 본인의 직함과 성명이 기본 입력되며, 타 담당자 명의로 발송 시 즉시 수정할 수 있습니다.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* A4 Sheet View (Matches third outline image_baa71618.png exactly) */}
      <div className="flex justify-center w-full overflow-x-auto pb-8 print:p-0 print:overflow-visible">
        <div
          id="printable-official-letter"
          className="relative bg-white text-slate-900 shadow-xl border print:shadow-none print:border-none w-[210mm] min-h-[297mm] p-[18mm] sm:p-[20mm] flex flex-col justify-between shrink-0"
          style={{
            fontFamily: '"Malgun Gothic", "맑은 고딕", Dotum, sans-serif',
            boxSizing: 'border-box',
          }}
        >
          {/* Centered Large Vertical Watermark (Exact placement from Image 3) */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-0"
            aria-hidden="true"
            style={{ transform: 'translateY(40mm)' }}
          >
            <img
              src="/assets/aistudio/__4273682d.png"
              alt="Air Liquide Watermark"
              className="w-[300px] h-auto object-contain opacity-[0.11] grayscale-0"
            />
          </div>

          <div className="relative z-10 space-y-4">
            {/* Header: Exact Horizontal Logo & Corporate Address */}
            <div className="flex items-start justify-between pb-2">
              <div className="pt-0.5">
                <AirLiquideLogo className="h-9 sm:h-10" />
              </div>
              <div className="text-right text-[10px] sm:text-[10.5px] leading-tight text-slate-700 space-y-0.5">
                <p className="font-semibold text-slate-800">
                  04527 서울특별시 중구 통일로 10, 20층 (연세대학교 세브란스빌딩)
                </p>
                <p className="text-[9.5px] text-slate-500">
                  20F, 10, Tongil-ro, Jung-gu, Seoul, Republic of Korea, 04527
                </p>
                <p className="text-[10px] text-slate-600 font-mono">
                  T 02) 721-0800, F 02) 721-5896
                </p>
              </div>
            </div>

            {/* Divider 1: Thin gray horizontal line below header */}
            <div className="border-t border-slate-300 -mt-1" />

            {/* Metadata Section with standard Korean official document layout */}
            <div className="text-[13px] leading-relaxed text-slate-900 space-y-1.5 pt-2">
              <div className="flex items-start">
                <span className="w-24 shrink-0 font-medium">문 서 번 호 :</span>
                <span className="font-medium text-slate-900">{letter.doc_number}</span>
              </div>
              <div className="flex items-start">
                <span className="w-24 shrink-0 font-medium">발 송 일 자 :</span>
                <span>{letter.dispatch_date}</span>
              </div>
              <div className="flex items-start">
                <span className="w-24 shrink-0 font-medium">
                  수<span className="inline-block w-[4.6em]"></span>신 :
                </span>
                <span className="font-medium">{letter.recipient}</span>
              </div>
              <div className="flex items-start">
                <span className="w-24 shrink-0 font-medium">
                  참<span className="inline-block w-[4.6em]"></span>조 :
                </span>
                <span>{letter.reference}</span>
              </div>
              <div className="flex items-start">
                <span className="w-24 shrink-0 font-medium">
                  발<span className="inline-block w-[4.6em]"></span>신 :
                </span>
                <span>{letter.sender}</span>
              </div>
              <div className="flex items-start pt-0.5">
                <span className="w-24 shrink-0 font-bold">
                  제<span className="inline-block w-[4.6em]"></span>목 :
                </span>
                <span className="font-bold text-slate-950 text-[13.5px]">{letter.subject}</span>
              </div>
            </div>

            {/* Divider 2: Solid divider line under subject */}
            <div className="border-t-2 border-slate-700 my-2.5" />

            {/* Body Content */}
            <div className="text-[13px] leading-[1.85] text-slate-900 space-y-3.5 pt-1">
              {letter.content_paragraphs.map((para, idx) => (
                <div key={idx} className="flex items-start gap-1.5 text-justify">
                  <span className="font-medium shrink-0 w-5">{idx + 1}.</span>
                  <p className="flex-1 whitespace-pre-wrap">{para}</p>
                </div>
              ))}

              {/* Sub-items (- 아래 -) */}
              {letter.sub_items && letter.sub_items.length > 0 && (
                <div className="pt-2 space-y-2.5">
                  <div className="text-center font-bold text-[13.5px] tracking-wider my-2.5 text-slate-800">
                    {letter.sub_items_title || '- 아 래 -'}
                  </div>

                  <div className="space-y-2 pl-3">
                    {letter.sub_items.map((item, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-start gap-1.5">
                          <span className="font-bold shrink-0">{item.label}</span>
                          <span className="font-medium">{item.text}</span>
                        </div>

                        {item.sub_bullets && item.sub_bullets.length > 0 && (
                          <div className="pl-6 space-y-0.5 text-[12.5px] text-slate-800">
                            {item.sub_bullets.map((b, bIdx) => (
                              <div key={bIdx} className="flex items-start gap-2">
                                <span className="font-bold">•</span>
                                <span>{b}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Signoff & Date (Editable by author) */}
          <div className="relative z-10 pt-16 pb-8 text-center space-y-3.5">
            <p className="text-[14px] font-medium tracking-widest text-slate-800">
              {letter.dispatch_date.replace(/\./g, '년').replace(/\s/g, ' ').slice(0, -1) || letter.dispatch_date}
            </p>
            <div className="space-y-2">
              <p className="text-[17px] font-bold tracking-wider text-slate-900">
                {letter.sender_department}
              </p>
              <div className="flex items-center justify-center gap-3 text-[16px] font-bold text-slate-900 pt-1">
                <span>{letter.sender_title}</span>
                <span className="tracking-[0.8em] pl-2">{letter.sender_name}</span>
                {/* Official seal preview stamp */}
                <span className="inline-block border border-dashed border-red-300 text-red-500 text-[10px] px-1.5 py-0.5 rounded ml-2 font-normal print:hidden">
                  (직인)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print Specific CSS */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-official-letter, #printable-official-letter * {
            visibility: visible !important;
          }
          #printable-official-letter {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 210mm !important;
            min-height: 297mm !important;
            margin: 0 !important;
            padding: 20mm !important;
            box-shadow: none !important;
            border: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export default OfficialLetterEditor;
