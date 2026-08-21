/**
 * Work-plan `method` section: ordered steps array (+ optional calc notes).
 * Never spread an array into `{...arr, notes}` — that corrupts PDF/preview.
 */

export type MethodStep = {
  order: number;
  description: string;
  safety_measure: string;
};

export type MethodSectionShape = {
  steps: MethodStep[];
  notes: string;
};

/** Recover steps from a clean array or a corrupted `{ "0": step, notes }` object. */
export function parseMethodSection(content: string | null | undefined): MethodSectionShape {
  const empty: MethodSectionShape = { steps: [], notes: "" };
  if (!content || !String(content).trim()) return empty;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return {
        steps: parsed.map((s, i) => normalizeStep(s, i)),
        notes: "",
      };
    }
    if (parsed && typeof parsed === "object") {
      const notes = typeof parsed.notes === "string" ? parsed.notes : "";
      const steps: MethodStep[] = [];
      const keys = Object.keys(parsed)
        .filter((k) => k !== "notes" && /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b));
      if (keys.length) {
        for (const k of keys) steps.push(normalizeStep(parsed[k], Number(k)));
      } else if (Array.isArray(parsed.steps)) {
        for (let i = 0; i < parsed.steps.length; i++) {
          steps.push(normalizeStep(parsed.steps[i], i));
        }
      }
      return { steps, notes };
    }
  } catch {
    /* plain text */
  }
  return { steps: [], notes: String(content) };
}

function normalizeStep(s: any, index: number): MethodStep {
  return {
    order: Number(s?.order) || index + 1,
    description: String(s?.description || ""),
    safety_measure: String(s?.safety_measure || ""),
  };
}

/** Persist as a JSON array (editor/PDF SSOT). Notes become an extra step when present. */
export function serializeMethodSection(shape: MethodSectionShape): string {
  const steps = [...shape.steps];
  const notes = String(shape.notes || "").trim();
  if (notes) {
    steps.push({
      order: steps.length + 1,
      description: "법규·계산 참고",
      safety_measure: notes,
    });
  }
  return JSON.stringify(
    steps.map((s, i) => ({
      order: s.order || i + 1,
      description: s.description,
      safety_measure: s.safety_measure,
    })),
  );
}

/** Append calculator text without corrupting the step array. */
export function appendTextToMethodSection(
  content: string | null | undefined,
  text: string,
): string {
  const t = String(text || "").trim();
  if (!t) return content || "[]";
  const shape = parseMethodSection(content);
  const nextNotes = shape.notes ? `${shape.notes}\n\n${t}` : t;
  return serializeMethodSection({ steps: shape.steps, notes: nextNotes });
}

/** Steps (+ trailing notes block) for PDF / print HTML. */
export function methodStepsForPrint(content: string | null | undefined): MethodStep[] {
  const shape = parseMethodSection(content);
  if (!shape.notes.trim()) return shape.steps;
  return [
    ...shape.steps,
    {
      order: shape.steps.length + 1,
      description: "법규·계산 참고",
      safety_measure: shape.notes.trim(),
    },
  ];
}
