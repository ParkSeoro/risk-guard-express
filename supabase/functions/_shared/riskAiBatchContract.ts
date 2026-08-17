/**
 * Contract helpers for risk-job-orchestrator ↔ generate-risk-ai batch calls.
 * Batch must force JSON (`stream: false`); SSE must not be treated as empty success.
 */

export function buildRiskAiBatchRequestBody(baseBody: Record<string, unknown>, task: {
  subProcess: string;
  count: number;
  index: number;
}) {
  return {
    ...baseBody,
    process_name: task.subProcess,
    target_count: task.count,
    batch_index: task.index,
    batch_size: task.count,
    stream: false,
    response_mode: "json",
  };
}

export function isJsonContentType(contentType: string | null | undefined): boolean {
  return String(contentType || "").toLowerCase().includes("application/json");
}

/**
 * Parse a successful JSON batch response. Throws on contract violations.
 */
export function parseRiskAiBatchJsonResult(result: unknown): {
  items: unknown[];
  source: string | null;
  error: string | null;
} {
  if (!result || typeof result !== "object") {
    throw new Error("generate-risk-ai returned empty/non-object JSON");
  }
  const r = result as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : null;
  const err = r.error != null ? String(r.error) : null;
  if (items == null) {
    throw new Error(err || "generate-risk-ai JSON missing items[]");
  }
  if (items.length === 0 && err) {
    throw new Error(err);
  }
  return {
    items,
    source: r.source != null ? String(r.source) : null,
    error: err,
  };
}
