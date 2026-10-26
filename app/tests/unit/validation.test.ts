import { describe, expect, it } from "vitest";
import {
  createStaffSchema,
  loginSchema,
  updateStaffSchema,
} from "@/lib/validation/staff.schema";

describe("staff request validation", () => {
  it("normalises the email and accepts a strong enough password", () => {
    const parsed = createStaffSchema.parse({
      name: "Ibu Sari",
      email: "  Sari@Panti.Local ",
      password: "PengasuhLokal2026!",
      role: "pengasuh",
    });

    expect(parsed.email).toBe("sari@panti.local");
    expect(parsed.role).toBe("pengasuh");
  });

  it("rejects passwords shorter than 12 characters", () => {
    const result = createStaffSchema.safeParse({
      name: "Ibu Sari",
      email: "sari@panti.local",
      password: "pendek123",
      role: "pengasuh",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toContain("password");
  });

  it("rejects unknown roles and invalid emails", () => {
    expect(
      createStaffSchema.safeParse({
        name: "X",
        email: "bukan-email",
        password: "PengasuhLokal2026!",
        role: "pengasuh",
      }).success,
    ).toBe(false);

    expect(
      createStaffSchema.safeParse({
        name: "X",
        email: "x@panti.local",
        password: "PengasuhLokal2026!",
        role: "superadmin",
      }).success,
    ).toBe(false);
  });

  it("requires at least one change on update", () => {
    expect(updateStaffSchema.safeParse({}).success).toBe(false);
    expect(updateStaffSchema.safeParse({ active: false }).success).toBe(true);
    expect(updateStaffSchema.safeParse({ role: "ketua" }).success).toBe(true);
  });

  it("does not accept a role change to itself as a validation error", () => {
    // The service decides whether the role actually changes; validation stays
    // permissive so the audit trail can record an idempotent request.
    expect(updateStaffSchema.safeParse({ role: "admin" }).success).toBe(true);
  });

  it("validates login input without leaking password rules", () => {
    expect(loginSchema.safeParse({ email: "a@panti.local", password: "x" }).success).toBe(
      true,
    );
    expect(loginSchema.safeParse({ email: "a@panti.local", password: "" }).success).toBe(
      false,
    );
  });
});
