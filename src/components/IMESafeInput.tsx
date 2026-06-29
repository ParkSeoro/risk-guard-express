import React, { useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { correctTerms } from "@/lib/termCorrection";

interface IMESafeInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'defaultValue'> {
  defaultValue: string;
  onCommit: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
  /** 커밋 시점에 용어 표준화(굴삭기→굴착기 등) 자동 적용. 기본 true. 비한글 필드(번호, URL 등)에선 false. */
  applyTermCorrection?: boolean;
}

/**
 * IME-safe input — Korean composition 보호 + 용어 표준화 통합.
 * 커밋 시점(블러/Enter)에 termCorrection을 자동 적용해 페이지마다 따로 처리할 필요 없음.
 */
const IMESafeInput = React.memo(React.forwardRef<HTMLInputElement, IMESafeInputProps>(
  ({ defaultValue, onCommit, className, autoFocus, applyTermCorrection = true, ...rest }, forwardedRef) => {
    const innerRef = useRef<HTMLInputElement>(null);
    const composingRef = useRef(false);

    const ref = (forwardedRef as React.RefObject<HTMLInputElement>) || innerRef;

    useEffect(() => {
      if (autoFocus && innerRef.current) {
        innerRef.current.focus();
      }
    }, [autoFocus]);

    const commit = (raw: string) => {
      const value = applyTermCorrection ? correctTerms(raw) : raw;
      if (value !== raw && innerRef.current) {
        innerRef.current.value = value;
      }
      onCommit(value);
    };

    return (
      <Input
        ref={innerRef}
        defaultValue={defaultValue}
        className={className}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onBlur={(e) => {
          if (!composingRef.current) {
            commit(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && !composingRef.current) {
            commit((e.target as HTMLInputElement).value);
          }
        }}
        {...rest}
      />
    );
  }
));

IMESafeInput.displayName = "IMESafeInput";

export default IMESafeInput;
