import type { StaffRole } from "./roles";

/**
 * Normative permission matrix from PRD-PANTI-001 section 4.2, expressed as
 * capability codes. Ownership and credential checks (psychologist draft owner,
 * verified professional credential) are enforced inside the domain services,
 * not by this table alone.
 */
export const PERMISSION_MATRIX = {
  "profile.intake.write": ["pengasuh", "ketua", "psikolog", "admin"],
  "assessment.internal.read": ["pengasuh", "ketua", "psikolog", "admin"],
  "ai.generate.first": ["pengasuh", "ketua", "psikolog", "admin"],
  "ai.regenerate": ["ketua", "psikolog", "admin"],
  "ai.mark_needs_revision": ["pengasuh", "ketua", "psikolog", "admin"],
  "ai.review.decide": ["ketua", "psikolog"],
  "psych.analysis.write": ["psikolog"],
  "psych.analysis.draft.read": ["psikolog"],
  "psych.analysis.final.read": ["pengasuh", "ketua", "psikolog", "admin"],
  "monitoring.note.write": ["pengasuh", "ketua", "psikolog", "admin"],
  "flag.create": ["pengasuh", "ketua", "psikolog", "admin"],
  "flag.acknowledge": ["pengasuh", "ketua", "psikolog", "admin"],
  "flag.resolve": ["ketua", "psikolog"],
  "report.internal.create": ["pengasuh", "ketua", "psikolog", "admin"],
  "report.guardian.request": ["pengasuh", "ketua", "psikolog", "admin"],
  "report.guardian.decide": ["ketua", "psikolog"],
  "report.guardian.approved.read": ["pengasuh", "ketua", "psikolog", "admin"],
  "profile.archive": ["ketua", "admin"],
  "profile.restore": ["ketua", "admin"],
  "admin.ai_settings": ["admin"],
  "admin.storage": ["admin"],
  "admin.users": ["admin"],
  "admin.general_settings": ["admin"],
  "admin.audit.read": ["admin"],
  "instrument.approve": ["psikolog"],
  "instrument.revoke": ["ketua", "psikolog"],
  "export.csv": ["ketua", "psikolog", "admin"],
  "assessment.withdraw": ["ketua", "psikolog"],
  "authority.review": ["ketua"],
  "intake_session.create": ["pengasuh", "ketua", "psikolog", "admin"],
  "intake_session.revoke_any": ["ketua", "admin"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type PermissionCode = keyof typeof PERMISSION_MATRIX;

export class PermissionDeniedError extends Error {
  readonly permission: PermissionCode;

  constructor(permission: PermissionCode) {
    super(`Role is not allowed to perform ${permission}`);
    this.name = "PermissionDeniedError";
    this.permission = permission;
  }
}

export function can(role: StaffRole, permission: PermissionCode): boolean {
  const allowed = PERMISSION_MATRIX[permission] as readonly StaffRole[];
  return allowed.includes(role);
}

export function permissionsForRole(role: StaffRole): PermissionCode[] {
  return (Object.keys(PERMISSION_MATRIX) as PermissionCode[]).filter((permission) =>
    can(role, permission),
  );
}

export function assertCan(role: StaffRole, permission: PermissionCode): void {
  if (!can(role, permission)) {
    throw new PermissionDeniedError(permission);
  }
}
