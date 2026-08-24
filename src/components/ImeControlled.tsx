import { useEffect, useRef, useState, type ChangeEvent, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * 한글 IME 조합 중 부모 state 리렌더가 value 를 덮어 글자가 사라지는 것을 막는다.
 * 조합 중에는 로컬 값을 유지하고, 조합이 끝나면 부모 onChange 와 동기화한다.
 */
function useImeValue(value: string, onChange?: (next: string) => void) {
  const composingRef = useRef(false);
  const [inner, setInner] = useState(value);
  useEffect(() => {
    if (!composingRef.current) setInner(value);
  }, [value]);

  return {
    value: inner,
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: (raw: string) => {
      composingRef.current = false;
      setInner(raw);
      onChange?.(raw);
    },
    onValueChange: (raw: string) => {
      setInner(raw);
      if (!composingRef.current) onChange?.(raw);
    },
  };
}

type InputProps = ComponentProps<typeof Input>;
type TextareaProps = ComponentProps<typeof Textarea>;

export function ImeControlledInput({ value, onChange, ...rest }: InputProps) {
  const ime = useImeValue(String(value ?? ""), (next) => {
    onChange?.({ target: { value: next } } as ChangeEvent<HTMLInputElement>);
  });
  return (
    <Input
      {...rest}
      value={ime.value}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={(e) => ime.onCompositionEnd(e.currentTarget.value)}
      onChange={(e) => ime.onValueChange(e.target.value)}
    />
  );
}

export function ImeControlledTextarea({ value, onChange, ...rest }: TextareaProps) {
  const ime = useImeValue(String(value ?? ""), (next) => {
    onChange?.({ target: { value: next } } as ChangeEvent<HTMLTextAreaElement>);
  });
  return (
    <Textarea
      {...rest}
      value={ime.value}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={(e) => ime.onCompositionEnd(e.currentTarget.value)}
      onChange={(e) => ime.onValueChange(e.target.value)}
    />
  );
}
