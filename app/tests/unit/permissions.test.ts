import { describe, expect, it } from "vitest";
import {
  PERMISSION_MATRIX,
  can,
  permissionsForRole,
} from "@/lib/permissions";
import { STAFF_ROLES, type StaffRole } from "@/lib/roles";

/**
 * The matrix in PRD section 4.2 is normative: these assertions exist so a later
 * refactor cannot silently widen a role.
 */
describe("permission matrix", () => {
  it("keeps psychologist-only clinical writes", () => {
    expect(can("psikolog", "psych.analysis.write")).toBe(true);
    for (const role of ["pengasuh", "ketua", "admin"] as StaffRole[]) {
      expect(can(role, "psych.analysis.write")).toBe(false);
    }
  });

  it("reserves review decisions for ketua and psikolog", () => {
    expect(PERMISSION_MATRIX["ai.review.decide"]).toEqual(["ketua", "psikolog"]);
    expect(can("admin", "ai.review.decide")).toBe(false);
    expect(can("pengasuh", "ai.review.decide")).toBe(false);
  });

  it("keeps administration inside the admin role", () => {
    const adminOnly = [
      "admin.users",
      "admin.audit.read",
      "admin.ai_settings",
      "admin.storage",
      "admin.general_settings",
    ] as const;
    for (const permission of adminOnly) {
      expect(can("admin", permission)).toBe(true);
      for (const role of ["pengasuh", "ketua", "psikolog"] as StaffRole[]) {
        expect(can(role, permission)).toBe(false);
      }
    }
  });

  it("lets pengasuh do intake but not irreversible decisions", () => {
    expect(can("pengasuh", "profile.intake.write")).toBe(true);
    expect(can("pengasuh", "ai.generate.first")).toBe(true);
    expect(can("pengasuh", "report.guardian.decide")).toBe(false);
    expect(can("pengasuh", "profile.archive")).toBe(false);
    expect(can("pengasuh", "assessment.withdraw")).toBe(false);
    expect(can("pengasuh", "export.csv")).toBe(false);
  });

  it("limits authority review to the chairperson", () => {
    expect(PERMISSION_MATRIX["authority.review"]).toEqual(["ketua"]);
  });

  it("derives a stable permission list per role without duplicates", () => {
    for (const role of STAFF_ROLES) {
      const permissions = permissionsForRole(role);
      expect(new Set(permissions).size).toBe(permissions.length);
      expect(permissions.length).toBeGreaterThan(0);
      for (const permission of permissions) {
        expect(can(role, permission)).toBe(true);
      }
    }
    // Admin never inherits clinical privileges (DEC-12).
    expect(permissionsForRole("admin")).not.toContain("psych.analysis.write");
    expect(permissionsForRole("psikolog")).not.toContain("admin.users");
  });

  it("gives every role a non-empty capability set", () => {
    for (const role of STAFF_ROLES) {
      expect(permissionsForRole(role).length).toBeGreaterThan(5);
    }
  });
});
