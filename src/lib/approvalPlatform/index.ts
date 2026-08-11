/**
 * 전자결재 플랫폼 (독립 모듈)
 * ------------------------------------------------------------------
 * 다른 업무 모듈(위평/계획서/허가서…)이 가져다 쓰는 결재 인프라.
 *
 * - 문서별 결재선 draft 저장 (`document_approval_drafts`)
 * - 모듈별 정책 (`entityPolicies`)
 * - 상신은 draft ready 일 때만 (`submit_approval_from_draft`)
 *
 * 허가서(work_permit)는 현행 경로를 유지하며 usesPlatformDraft=false.
 */

export * from './types';
export * from './entityPolicies';
export * from './validateDraftSteps';
export * from './draftClient';
