import { SafetyAssistant } from '@/components/SafetyAssistant';
import { Bot } from 'lucide-react';

const AIAssistant = () => {
  return (
    <div className="space-y-4 animate-fade-in max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" /> AI 안전 어시스턴트
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          산업안전보건법 기반 AI 질의응답 · 법적 의무 체크리스트 · 안전관리 가이드
        </p>
      </div>
      <div className="h-[calc(100vh-200px)]">
        <SafetyAssistant />
      </div>
    </div>
  );
};

export default AIAssistant;
