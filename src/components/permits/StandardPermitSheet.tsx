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
          @page { size: A4 portrait; margin: 6mm; }
          html, body { width: 210mm; height: 297mm; margin: 0 !important; padding: 0 !important; background: white !important; }
          .standard-permit-sheet-wrap { overflow: visible !important; width: 100% !important; }
          .standard-permit-sheet {
            width: 198mm !important;
            min-height: auto !important;
            max-height: 285mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            box-shadow: none !important;
            transform: scale(0.92);
            transform-origin: top left;
            page-break-after: avoid;
            page-break-inside: avoid;
          }
          .standard-permit-sheet * { page-break-inside: avoid !important; }
          .standard-permit-sheet .page-break { page-break-after: auto !important; }
          .dig-permit-form { font-size: 9pt !important; }
          .dig-permit-form td, .dig-permit-form th { padding: 2px 3px !important; }
          .dig-permit-form tr, .dig-permit-form td { height: 20px !important; min-height: 18px !important; }
          .dig-permit-form h2.title { font-size: 15pt !important; margin: 2px 0 !important; letter-spacing: 2px !important; }
          .dig-permit-form .form-header .logo { max-height: 36px !important; }
        }
      `}</style>
      <div className="standard-permit-sheet">
        {children}
      </div>
    </div>
  );
}