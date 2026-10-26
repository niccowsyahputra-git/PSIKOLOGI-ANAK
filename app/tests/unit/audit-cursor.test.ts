import { describe, expect, it } from "vitest";
import {
  AUDIT_MAX_PAGE_SIZE,
  AUDIT_PAGE_SIZE,
  decodeAuditCursor,
  encodeAuditCursor,
  parseAuditLimit,
} from "@/lib/audit-cursor";

describe("audit pagination helpers", () => {
  it("round-trips a cursor without exposing readable row ids", () => {
    const row = { createdAt: new Date("2026-01-02T03:04:05.000Z"), id: "row-1" };
    const encoded = encodeAuditCursor(row);
    expect(encoded).not.toContain(":");

    const decoded = decodeAuditCursor(encoded);
    expect(decoded?.id).toBe("row-1");
    expect(decoded?.createdAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });

  it("ignores malformed or missing cursors instead of throwing", () => {
    expect(decodeAuditCursor(null)).toBeUndefined();
    expect(decodeAuditCursor("")).toBeUndefined();
    expect(decodeAuditCursor("bm90LWEtY3Vyc29y")).toBeUndefined();
    expect(
      decodeAuditCursor(Buffer.from("bukan-tanggal|row-1").toString("base64url")),
    ).toBeUndefined();
  });

  it("clamps the page size to a safe range", () => {
    expect(parseAuditLimit(null)).toBe(AUDIT_PAGE_SIZE);
    expect(parseAuditLimit("abc")).toBe(AUDIT_PAGE_SIZE);
    expect(parseAuditLimit("0")).toBe(AUDIT_PAGE_SIZE);
    expect(parseAuditLimit("-5")).toBe(AUDIT_PAGE_SIZE);
    expect(parseAuditLimit("10")).toBe(10);
    expect(parseAuditLimit("9999")).toBe(AUDIT_MAX_PAGE_SIZE);
  });
});
