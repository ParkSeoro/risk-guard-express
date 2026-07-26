import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import {
  ShieldAlert, FileSignature, ClipboardCheck, AlertOctagon, FileText, HardHat,
} from 'lucide-react';

interface CTA {
  title: string;
  desc: string;
  to: string;
  icon: any;
  color: string;
}

const CTAS: CTA[] = [
  { title: '오늘의 위험성 평가', desc: '작업 전 위험 요인 확인', to: '/risk-assessment', icon: ShieldAlert, color: 'bg-orange-500' },
  { title: '작업허가서 상신', desc: '허가서 작성/결재 요청', to: '/work-permits', icon: FileSignature, color: 'bg-blue-600' },
  { title: '작업계획서', desc: '오늘 작업 계획 등록', to: '/work-plans', icon: FileText, color: 'bg-emerald-600' },
  { title: 'TBM 일지', desc: '작업 전 안전 미팅 기록', to: '/tbm-logs', icon: ClipboardCheck, color: 'bg-purple-600' },
  { title: '사고/아차사고 보고', desc: '즉시 보고', to: '/incidents', icon: AlertOctagon, color: 'bg-red-600' },
  { title: '근로자 명부', desc: '오늘 출역 인원 확인', to: '/workers', icon: HardHat, color: 'bg-slate-700' },
];

export default function ContractorDashboard({ siteLabel }: { siteLabel?: string }) {
  const navigate = useNavigate();
  return (
    <div className="max-w-5xl mx-auto space-y-6 py-6 animate-fade-in">
      <div className="text-center space-y-1">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">오늘 무엇을 하시겠어요?</h1>
        {siteLabel && <p className="text-sm text-muted-foreground">{siteLabel}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CTAS.map((c) => (
          <Card
            key={c.to}
            onClick={() => navigate(c.to)}
            className="cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all p-6 flex items-center gap-4 border-2"
          >
            <div className={`h-14 w-14 rounded-xl ${c.color} flex items-center justify-center shrink-0`}>
              <c.icon className="h-7 w-7 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold">{c.title}</div>
              <div className="text-sm text-muted-foreground mt-0.5">{c.desc}</div>
            </div>
            <div className="text-2xl text-muted-foreground">›</div>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground pt-4">
        도움이 필요하면 좌측 상단 메뉴 → <b>사용 설명서</b> 를 확인하세요.
      </p>
    </div>
  );
}
