import { ReactNode } from 'react';

interface StandardPermitSheetProps {
  children: ReactNode;
  mode?: 'screen' | 'print';
  className?: string;
}

/**
 * 표준 SF003 렌더링 공통 시트.
 * 디자인 미리보기 / 작성 화면 / 인쇄 폴백이 같은 A4 폭·여백에서 계산되도록 고정한다.
 */
export default function StandardPermitSheet({ children, mode = 'screen', className = '' }: StandardPermitSheetProps) {
  const isPrintPreview = mode === 'print';

  return (
    <div className={`standard-permit-sheet-wrap w-full overflow-x-auto ${className}`}>
      <style>{`
        .standard-permit-sheet {
          width: 210mm;
          min-height: ${isPrintPreview ? '297mm' : 'auto'};
          margin: 0 auto;
          padding: 12mm;
          background: white;
          color: #111827;
          box-sizing: border-box;
          box-shadow: ${isPrintPreview ? '0 0 8px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.10)'};
        }
        @media print {
          .standard-permit-sheet-wrap { overflow: visible !important; }
          .standard-permit-sheet {
            width: 210mm;
            min-height: auto;
            margin: 0;
            padding: 8mm;
            box-shadow: none;
          }
        }
      `}</style>
      <div className="standard-permit-sheet">
        {children}
      </div>
    </div>
  );
}