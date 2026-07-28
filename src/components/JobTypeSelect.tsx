import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { jobCategoryEntries, type StandardJobType } from "@/lib/jobCategories";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onValueChange: (value: StandardJobType) => void;
  placeholder?: string;
  disabled?: boolean;
  triggerClassName?: string;
  id?: string;
};

/** 플랜트 표준 직종 — 카테고리 그룹 Select (주관식·기타 없음) */
export default function JobTypeSelect({
  value,
  onValueChange,
  placeholder = "직종 선택",
  disabled,
  triggerClassName,
  id,
}: Props) {
  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => onValueChange(v as StandardJobType)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn(triggerClassName)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {jobCategoryEntries().map(([category, jobs]) => (
          <SelectGroup key={category}>
            <SelectLabel>{category}</SelectLabel>
            {jobs.map((job) => (
              <SelectItem key={job} value={job}>
                {job}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
