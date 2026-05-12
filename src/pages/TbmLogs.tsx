import TbmManager from '@/components/tbm/TbmManager';
import { ClipboardList } from 'lucide-react';
import { useProjectAccess } from '@/hooks/useProjectAccess';

export default function TbmLogs() {
  const { selectedProject: projectId, loading } = useProjectAccess();

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">로딩 중...</div>;
  }

  if (!projectId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        프로젝트를 먼저 선택하세요.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6" /> TBM 일지
        </h1>
        <p className="text-sm text-muted-foreground">
          프로젝트의 모든 TBM 세션을 생성·수정·삭제하고 QR 출력 및 참여자를 관리합니다.
        </p>
      </div>
      <TbmManager projectId={projectId} />
    </div>
  );
}
