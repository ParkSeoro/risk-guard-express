import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Bot, Send, ClipboardCheck, BookOpen, AlertTriangle,
  Search, Loader2, X, Maximize2, Minimize2
} from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_ACTIONS = [
  { id: 'legal_checklist', label: '법적 의무 체크리스트', icon: ClipboardCheck },
  { id: 'safety_manager_guide', label: '안전관리자 직무 가이드', icon: BookOpen },
  { id: 'serious_accident_guide', label: '중대재해 예방 가이드', icon: AlertTriangle },
  { id: 'inspection_guide', label: '안전점검 항목 가이드', icon: Search },
];

const FAQ_SUGGESTIONS = [
  '위험성평가 실시 절차를 알려주세요',
  '작업계획서에 반드시 포함해야 하는 항목은?',
  '안전관리자의 법적 배치 기준은?',
  '중대재해처벌법 적용 대상은?',
  '고소작업 안전조치 사항을 알려주세요',
];

export function SafetyAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (text: string, type?: string) => {
    if (!text.trim() && !type) return;

    const userMsg = text.trim() || QUICK_ACTIONS.find(a => a.id === type)?.label || '';
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke('safety-assistant', {
        body: { message: userMsg, type, history },
      });

      if (error) throw error;

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data?.response || '응답을 생성할 수 없습니다.',
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '죄송합니다. 일시적인 오류가 발생했습니다. 다시 시도해 주세요.',
      }]);
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <Card className={`flex flex-col ${expanded ? 'fixed inset-4 z-50 shadow-2xl' : 'h-full'}`}>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          AI 안전 어시스턴트
          <Badge variant="outline" className="text-[9px] ml-1">산업안전보건법 기반</Badge>
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          {messages.length > 0 && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMessages([])}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col min-h-0 pb-3">
        <ScrollArea className="flex-1 pr-2" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="space-y-4 py-2">
              {/* Quick Actions */}
              <div className="grid grid-cols-2 gap-2">
                {QUICK_ACTIONS.map(action => (
                  <button
                    key={action.id}
                    onClick={() => sendMessage('', action.id)}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-border hover:bg-accent/50 hover:border-primary/30 transition-all text-left"
                  >
                    <action.icon className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-xs font-medium">{action.label}</span>
                  </button>
                ))}
              </div>

              {/* FAQ Suggestions */}
              <div>
                <p className="text-[10px] text-muted-foreground font-medium mb-2">자주 묻는 질문</p>
                <div className="space-y-1.5">
                  {FAQ_SUGGESTIONS.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(q)}
                      className="w-full text-left text-xs p-2 rounded-md hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      💬 {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}>
                    <div className="whitespace-pre-wrap leading-relaxed prose prose-xs max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{
                        __html: msg.content
                          .replace(/^### (.*$)/gm, '<h4 class="font-bold text-xs mt-2 mb-1">$1</h4>')
                          .replace(/^## (.*$)/gm, '<h3 class="font-bold text-sm mt-3 mb-1">$1</h3>')
                          .replace(/^\- \[ \] (.*$)/gm, '<div class="flex items-center gap-1.5"><input type="checkbox" class="rounded" /><span>$1</span></div>')
                          .replace(/^\- \[x\] (.*$)/gm, '<div class="flex items-center gap-1.5"><input type="checkbox" checked class="rounded" /><span>$1</span></div>')
                          .replace(/^\- (.*$)/gm, '<div class="ml-2">• $1</div>')
                          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\n/g, '<br />')
                      }}
                    />
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">답변 생성 중...</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <form onSubmit={handleSubmit} className="flex gap-2 mt-2 pt-2 border-t">
          <Input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="안전 관련 질문을 입력하세요..."
            className="h-8 text-xs"
            disabled={loading}
          />
          <Button type="submit" size="icon" className="h-8 w-8 shrink-0" disabled={loading || !input.trim()}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
