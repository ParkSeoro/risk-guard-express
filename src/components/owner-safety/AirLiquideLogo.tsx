import React from 'react';

export function AirLiquideLogo({ className = 'h-9' }: { className?: string }) {
  return (
    <img
      src="/assets/aistudio/image_394002ab.png"
      alt="Air Liquide"
      className={`object-contain shrink-0 ${className}`}
    />
  );
}

export default AirLiquideLogo;
