import React, { useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";

interface IMESafeTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'defaultValue'> {
  defaultValue: string;
  onCommit: (value: string) => void;
  className?: string;
}

/**
 * IME-safe textarea — Korean (Hangul) composition 중에 onChange가 부모 state를 흔들면
 * 마지막 자모가 잘려나가는 문제를 막기 위한 컴포넌트.
 * - composition 중에는 commit 하지 않음
 * - blur(또는 Ctrl+Enter)에서만 부모로 값 전달
 */
const IMESafeTextarea = React.memo(React.forwardRef<HTMLTextAreaElement, IMESafeTextareaProps>(
  ({ defaultValue, onCommit, className, ...rest }, forwardedRef) => {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    const composingRef = useRef(false);

    return (
      <Textarea
        ref={(forwardedRef as any) || innerRef}
        defaultValue={defaultValue}
        className={className}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onBlur={(e) => {
          if (!composingRef.current) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            onCommit((e.target as HTMLTextAreaElement).value);
          }
        }}
        {...rest}
      />
    );
  }
));

IMESafeTextarea.displayName = "IMESafeTextarea";

export default IMESafeTextarea;
