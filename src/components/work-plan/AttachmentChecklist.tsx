import { useState, useEffect } from 'react';
import { generateAttachments, getAttachmentCategories, type AttachmentItem } from '@/lib/attachmentTemplates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Paperclip, Upload, CheckCircle2 } from 'lucide-react';

interface AttachmentStatus {
  key: string;
  uploaded: boolean;
  fileUrl?: string;
}

interface Props {
  workType: string;
  attachments: AttachmentStatus[];
  onAttachmentsChange: (attachments: AttachmentStatus[]) => void;
  onUpload: (index: number, file: File) => void;
  readOnly?: boolean;
}

export default function AttachmentChecklist({ workType, attachments, onAttachmentsChange, onUpload, readOnly }: Props) {
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<AttachmentItem[]>([]);

  useEffect(() => {
    const generated = generateAttachments(workType, conditions);
    setTemplate(generated);

    // Merge with existing attachments
    const merged = generated.map(g => {
      const existing = attachments.find(a => a.key === g.key);
      return existing || { key: g.key, uploaded: false };
    });
    onAttachmentsChange(merged);
  }, [workType, conditions]);

  const toggleCondition = (field: string) => {
    setConditions(prev => ({
      ...prev,
      [field]: prev[field] === 'true' ? 'false' : 'true',
    }));
  };

  const categories = getAttachmentCategories(template);
  const uploadedCount = attachments.filter(a => a.uploaded).length;
  const totalCount = template.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Paperclip className="h-4 w-4" /> 첨부자료 체크리스트
          </CardTitle>
          <Badge variant={uploadedCount === totalCount ? 'default' : 'outline'} className="text-[10px]">
            {uploadedCount}/{totalCount} 완료
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Condition toggles */}
        <div className="flex flex-wrap gap-4 p-3 bg-muted/30 rounded-lg">
          <span className="text-xs font-medium text-muted-foreground">작업 조건:</span>
          {[
            { field: 'night_work', label: '야간작업' },
            { field: 'road_work', label: '도로작업' },
            { field: 'hot_work', label: '화기작업' },
            { field: 'near_power_lines', label: '활선근접' },
          ].map(c => (
            <div key={c.field} className="flex items-center gap-1.5">
              <Switch
                id={c.field}
                checked={conditions[c.field] === 'true'}
                onCheckedChange={() => toggleCondition(c.field)}
                disabled={readOnly}
              />
              <Label htmlFor={c.field} className="text-xs cursor-pointer">{c.label}</Label>
            </div>
          ))}
        </div>

        {/* Attachments by category */}
        {categories.map(cat => (
          <div key={cat}>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">{cat}</h4>
            <div className="space-y-1.5">
              {template.filter(t => t.category === cat).map((item, idx) => {
                const attIdx = template.findIndex(t => t.key === item.key);
                const status = attachments.find(a => a.key === item.key);
                return (
                  <div key={item.key} className="flex items-center gap-2 p-2 rounded border bg-card hover:bg-muted/20">
                    {status?.uploaded ? (
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                    </div>
                    {item.required && <Badge variant="destructive" className="text-[9px] h-4 shrink-0">필수</Badge>}
                    {!readOnly && !status?.uploaded && (
                      <label className="cursor-pointer shrink-0">
                        <input type="file" className="hidden" onChange={e => {
                          if (e.target.files?.[0]) onUpload(attIdx, e.target.files[0]);
                        }} />
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 pointer-events-none">
                          <Upload className="h-3 w-3" /> 업로드
                        </Button>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
