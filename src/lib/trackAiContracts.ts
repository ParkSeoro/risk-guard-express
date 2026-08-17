/**
 * Re-export edge shared helpers for Vitest (same pattern as permitBriefing).
 */
export {
  digitsOnlyPhone,
  trackIdentityClaimMismatch,
} from "../../supabase/functions/_shared/trackLocationIdentity";

export {
  buildRiskAiBatchRequestBody,
  isJsonContentType,
  parseRiskAiBatchJsonResult,
} from "../../supabase/functions/_shared/riskAiBatchContract";
