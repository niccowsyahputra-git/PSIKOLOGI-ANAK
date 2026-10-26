/**
 * Staff roles are fixed by PRD-PANTI-001 section 4. One active role per
 * membership in v1 (DEC-12); admin never inherits clinical privileges.
 */
export const STAFF_ROLES = ["pengasuh", "ketua", "psikolog", "admin"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  pengasuh: "Pengasuh / Assessor",
  ketua: "Ketua Panti",
  psikolog: "Psikolog",
  admin: "Administrator",
};

export function isStaffRole(value: unknown): value is StaffRole {
  return (
    typeof value === "string" &&
    (STAFF_ROLES as readonly string[]).includes(value)
  );
}
