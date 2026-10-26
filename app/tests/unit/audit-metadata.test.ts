import { describe, expect, it } from "vitest";
import {
  isSafeAuditKey,
  sanitizeAuditMetadata,
  serializeAuditMetadata,
} from "@/lib/audit-metadata";

/**
 * FR-16 / section 12.4: audit metadata may hold identifiers, field names and
 * status only. Participant text, contact data and credentials must be dropped.
 */
describe("audit metadata sanitizer", () => {
  it("keeps identifier and status keys written by the domain services", () => {
    const safe = sanitizeAuditMetadata({
      authUserId: "user-1",
      role: "psikolog",
      previousRole: "pengasuh",
      active: true,
      revision: 3,
      status: "submitted",
    });

    expect(safe).toEqual({
      authUserId: "user-1",
      role: "psikolog",
      previousRole: "pengasuh",
      active: true,
      revision: 3,
      status: "submitted",
    });
  });

  it("drops anything that could carry child or guardian content", () => {
    const safe = sanitizeAuditMetadata({
      childName: "Budi",
      guardianEmail: "wali@example.com",
      answerText: "Jawaban bebas",
      sessionToken: "abc",
      password: "rahasia",
      note: "catatan",
      contact: "0812",
      birthDate: "2015-01-01",
      summary: "ringkasan",
      assessmentId: "assessment-1",
    });

    expect(safe).toEqual({ assessmentId: "assessment-1" });
  });

  it("rejects keys that merely end with a safe suffix after a denied word", () => {
    expect(isSafeAuditKey("participantName")).toBe(false);
    expect(isSafeAuditKey("answerText")).toBe(false);
    expect(isSafeAuditKey("credentialReference")).toBe(false);
    expect(isSafeAuditKey("entityId")).toBe(true);
    expect(isSafeAuditKey("mode")).toBe(true);
  });

  it("truncates long strings and joins simple arrays", () => {
    const safe = sanitizeAuditMetadata({
      action: "x".repeat(200),
      fieldIds: ["a", "b", "c"],
      emptyCode: "",
    });

    expect(safe.action).toBeUndefined();
    expect(safe.fieldIds).toBe("a,b,c");
    expect(safe.emptyCode).toBeUndefined();
  });

  it("keeps explicit nulls but drops unsupported shapes", () => {
    const safe = sanitizeAuditMetadata({
      entityId: null,
      meta: { nested: true },
      listOfObjects: [{ id: "1" }],
    });

    expect(safe).toEqual({ entityId: null });
  });

  it("serialises to a JSON object string without leaking values", () => {
    const serialised = serializeAuditMetadata(
      sanitizeAuditMetadata({ role: "admin", guardianName: "Ibu Sari" }),
    );
    expect(JSON.parse(serialised)).toEqual({ role: "admin" });
    expect(serialised).not.toContain("Sari");
  });
});
