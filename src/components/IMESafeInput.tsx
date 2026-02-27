import React, { useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";

interface IMESafeInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'defaultValue'> {
  defaultValue: string;
  onCommit: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
}

/**
 * IME-safe input component that prevents focus loss during Korean (hangul) composition.
 * - Tracks composition state via onCompositionStart/End
 * - Only commits value on blur (when not composing) or Enter (when not composing)
 * - Extracted as a top-level component to avoid remount issues from inline definitions
 */
const IMESafeInput = React.memo(React.forwardRef<HTMLInputElement, IMESafeInputProps>(
  ({ defaultValue, onCommit, className, autoFocus, ...rest }, forwardedRef) => {
    const innerRef = useRef<HTMLInputElement>(null);
    const composingRef = useRef(false);

    const ref = (forwardedRef as React.RefObject<HTMLInputElement>) || innerRef;

    useEffect(() => {
      if (autoFocus && innerRef.current) {
        innerRef.current.focus();
      }
    }, [autoFocus]);

    return (
      <Input
        ref={innerRef}
        defaultValue={defaultValue}
        className={className}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onBlur={(e) => {
          if (!composingRef.current) {
            onCommit(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && !composingRef.current) {
            onCommit((e.target as HTMLInputElement).value);
          }
        }}
        {...rest}
      />
    );
  }
));

IMESafeInput.displayName = "IMESafeInput";

export default IMESafeInput;
