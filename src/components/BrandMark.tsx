import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  size?: number;
  alt?: string;
};

/** SafeNex Icon B mark for web chrome (sidebar, auth, landing). */
export function BrandMark({ className, size = 36, alt = "SafeNex" }: BrandMarkProps) {
  return (
    <img
      src="/icon-192.png"
      alt={alt}
      width={size}
      height={size}
      className={cn("rounded-lg object-cover shrink-0", className)}
      draggable={false}
    />
  );
}
