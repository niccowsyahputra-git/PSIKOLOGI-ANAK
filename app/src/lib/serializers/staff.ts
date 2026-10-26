import { ROLE_LABELS, type StaffRole } from "@/lib/roles";
import type { StaffListRow } from "@/server/repositories/staff.repository";

/**
 * Wire shape for staff accounts (FR-01). Only identifiers, role and credential
 * *status* cross to the browser: password hashes, session tokens and audit
 * metadata never do (section 12.4).
 */
export type StaffWire = {
  membershipId: string;
  authUserId: string;
  name: string;
  email: string;
  role: StaffRole;
  roleLabel: string;
  active: boolean;
  credentialReference: string | null;
  credentialVerified: boolean;
  credentialVerifiedAt: string | null;
  createdAt: string;
};

export function toStaffWire(row: StaffListRow): StaffWire {
  return {
    membershipId: row.membershipId,
    authUserId: row.authUserId,
    name: row.name,
    email: row.email,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role],
    active: row.active,
    credentialReference: row.credentialReference,
    credentialVerified: row.credentialVerifiedAt !== null,
    credentialVerifiedAt: row.credentialVerifiedAt
      ? row.credentialVerifiedAt.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}
