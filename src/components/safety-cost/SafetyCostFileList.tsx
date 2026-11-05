import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { safetyCostFileGroup, type SafetyCostDocFile } from '@/lib/safetyCostDocumentBuilder';

const GROUPS = ['전체', '거래명세서', '세금계산서', '현장 사진', '인증서', '지급대장', '급여·선임·교육'] as const;

export default function SafetyCostFileList({ files }: { files: SafetyCostDocFile[] }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('전체');
  const visible = useMemo(
    () => files.filter((file) => group === '전체' || safetyCostFileGroup(file.evidence_kind) === group),
    [files, group],
  );
  if (!files.length) return <p className="text-xs text-muted-foreground">첨부 파일이 없습니다.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {GROUPS.map((name) => (
          <Button key={name} type="button" size="sm" variant={group === name ? 'default' : 'outline'} onClick={() => setGroup(name)}>
            {name}
          </Button>
        ))}
      </div>
      <ul className="space-y-1 text-sm">
        {visible.map((file) => (
          <li key={file.id}>
            {file.file_url ? (
              <a className="underline" href={file.file_url} target="_blank" rel="noreferrer">
                {file.file_name || '파일'}
              </a>
            ) : (
              <span>{file.file_name || '파일'}</span>
            )}
            <span className="text-muted-foreground"> · {safetyCostFileGroup(file.evidence_kind)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
