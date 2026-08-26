import { inferHazardType } from '@/lib/globalRiskLibrary';

/**
 * Deterministic 법적근거 from hazard type — same grain as PPE defaults.
 *
 * legal_references / process-keyed library are optional overlays.
 * They must not be required for [나머지 채우기] to complete 상신 빈칸.
 * Citations follow the in-app short form used by global_risk_library.
 */
const PPE_ARTICLE = '산안기준규칙 제32조';

function pushUnique(out: string[], value: string) {
  if (value && !out.includes(value)) out.push(value);
}

export function defaultLegalForHazard(hazard?: string | null, extra?: string | null): string[] {
  const blob = `${hazard || ''} ${extra || ''}`;
  const t = inferHazardType(blob);
  const out: string[] = [];

  switch (t) {
    case '추락':
      pushUnique(out, '산안기준규칙 제42조');
      break;
    case '낙하·비래':
      pushUnique(out, '산안기준규칙 제14조');
      break;
    case '협착·끼임':
      pushUnique(out, '산안기준규칙 제86조');
      break;
    case '감전':
      pushUnique(out, '산안기준규칙 제302조');
      pushUnique(out, '산안기준규칙 제321조');
      break;
    case '화재·폭발':
      pushUnique(out, '산안기준규칙 제241조');
      pushUnique(out, '산안기준규칙 제232조');
      break;
    case '질식':
      pushUnique(out, '산안기준규칙 제619조');
      break;
    case '화학·중독':
      pushUnique(out, '산안기준규칙 제422조');
      break;
    case '절단·베임':
      pushUnique(out, '산안기준규칙 제103조');
      break;
    case '붕괴·매몰':
      pushUnique(out, '산안기준규칙 제338조');
      break;
    case '전도·도괴':
      pushUnique(out, '산안기준규칙 제3조');
      break;
    case '충돌':
      pushUnique(out, '산안기준규칙 제171조');
      break;
    case '근골격':
      pushUnique(out, '산안기준규칙 제656조');
      break;
    default:
      break;
  }

  if (/사다리/.test(blob)) pushUnique(out, '산안기준규칙 제24조');
  if (/조도|투광등|조명/.test(blob)) pushUnique(out, '산안기준규칙 제8조');
  if (/전선|배선/.test(blob) && t !== '감전') pushUnique(out, '산안기준규칙 제313조');

  pushUnique(out, PPE_ARTICLE);
  return out;
}
