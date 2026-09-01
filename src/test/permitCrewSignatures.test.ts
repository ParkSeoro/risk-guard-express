import { describe, expect, it } from "vitest";
import {
  attachCrewPrintSignatures,
  fillMissingTbmSignatures,
  isRenderableSignature,
  pickCrewPrintSignature,
} from "@/lib/permitCrewSignatures";

const SIG = `data:image/png;base64,${"A".repeat(80)}`;

describe("permitCrewSignatures", () => {
  it("rejects blank or tiny signature payloads", () => {
    expect(isRenderableSignature(null)).toBe(false);
    expect(isRenderableSignature("")).toBe(false);
    expect(isRenderableSignature("short")).toBe(false);
    expect(isRenderableSignature(SIG)).toBe(true);
  });

  it("prints signed workers as images and leaves late/unsigned workers blank for handwriting", () => {
    const signed = pickCrewPrintSignature({
      workerId: "w1",
      workerPhone: "010-1111-1111",
      permitId: "p1",
      dailyAcks: [{ worker_id: "w1", permit_ids: ["p1"], signature_data: SIG }],
    });
    const late = pickCrewPrintSignature({
      workerId: "w2",
      workerPhone: "010-2222-2222",
      permitId: "p1",
      dailyAcks: [],
      tbmParts: [{ worker_id: "w2", signature_data: "" }],
    });
    expect(signed).toBe(SIG);
    expect(late).toBeNull();
  });

  it("shows a late clock-in signature on later print (archival, not frozen morning blanks)", () => {
    const workers = [
      { id: "w-early", name: "정하윤", phone: "01011111111" },
      { id: "w-late", name: "김지각", phone: "01022222222" },
    ];
    const morning = attachCrewPrintSignatures(workers, {
      permitId: "p1",
      dailyAcks: [{ worker_id: "w-early", permit_ids: ["p1"], signature_data: SIG }],
    });
    expect(morning[0].signature_data).toBe(SIG);
    expect(morning[1].signature_data).toBeNull();

    const afterLateAck = attachCrewPrintSignatures(workers, {
      permitId: "p1",
      dailyAcks: [
        { worker_id: "w-early", permit_ids: ["p1"], signature_data: SIG },
        { worker_id: "w-late", permit_ids: ["p1"], signature_data: SIG },
      ],
    });
    expect(afterLateAck[1].signature_data).toBe(SIG);
  });

  it("matches workers by phone when ids differ and skips acks for other permits", () => {
    const byPhone = pickCrewPrintSignature({
      workerId: "crew-1",
      workerPhone: "010-3333-4444",
      permitId: "p1",
      dailyAcks: [
        { worker_id: "other-id", worker_phone: "01033334444", permit_ids: ["p1"], signature_data: SIG },
      ],
    });
    const otherPermit = pickCrewPrintSignature({
      workerId: "w1",
      permitId: "p1",
      dailyAcks: [{ worker_id: "w1", permit_ids: ["p2"], signature_data: SIG }],
    });
    expect(byPhone).toBe(SIG);
    expect(otherPermit).toBeNull();
  });

  it("fills unsigned TBM rows from daily ack for archival TBM logs", () => {
    const filled = fillMissingTbmSignatures(
      [
        { worker_id: "w1", worker_phone: "01011111111", signature_data: "" },
        { worker_id: "w2", worker_phone: "01022222222", signature_data: SIG },
      ],
      [{ worker_id: "w1", signature_data: SIG }],
    );
    expect(filled[0].signature_data).toBe(SIG);
    expect(filled[1].signature_data).toBe(SIG);
  });
});
