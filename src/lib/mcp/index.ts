import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjects from "./tools/list-projects";
import listWorkPermits from "./tools/list-work-permits";
import listIncidents from "./tools/list-incidents";
import listRiskAssessments from "./tools/list-risk-assessments";

// Direct Supabase issuer required by mcp-js (must match discovery document).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "safenex-mcp",
  title: "SafeNex 안전관리 MCP",
  version: "0.1.0",
  instructions:
    "대한민국 산업안전보건법 기반 안전관리시스템(SafeNex)의 프로젝트, 작업허가서, 위험성평가, 사고보고서를 조회하는 도구입니다. 모든 도구는 로그인한 사용자 권한(RLS) 안에서 동작합니다.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProjects, listWorkPermits, listIncidents, listRiskAssessments],
});
