import { jsonOk, withApiHandler } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { getDbReady } from "@/lib/db";
import {
  ForbiddenError,
  RateLimitError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import { permissionsForRole } from "@/lib/permissions";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation/staff.schema";
import { findOrganizationById } from "@/server/repositories/organization.repository";
import { findMembershipByAuthUser } from "@/server/repositories/staff.repository";
import { recordAudit } from "@/server/services/audit.service";

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 60_000;

/**
 * Staff login wrapper (FR-01). It exists so that:
 *  - failures answer with one non-informative message (no account enumeration);
 *  - an authenticated user without an active membership gets no session;
 *  - successful and failed sign-ins are rate limited and audited.
 */
export const POST = withApiHandler(async (request) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationError("Body JSON tidak valid");
  }
  const input = loginSchema.parse(payload);

  const rate = consumeRateLimit(
    `login:${clientKeyFromRequest(request)}:${input.email}`,
    LOGIN_ATTEMPT_LIMIT,
    LOGIN_WINDOW_MS,
  );
  if (!rate.allowed) {
    throw new RateLimitError(
      `Terlalu banyak percobaan masuk. Coba lagi dalam ${rate.retryAfterSeconds} detik.`,
    );
  }

  const auth = getAuth();
  let signedInUser: { id: string; name: string; email: string };
  try {
    const result = await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      headers: request.headers,
    });
    signedInUser = {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
    };
  } catch {
    throw new UnauthenticatedError("Email atau kata sandi tidak sesuai");
  }

  const db = await getDbReady();
  const membership = await findMembershipByAuthUser(db, signedInUser.id);
  const organization = membership
    ? await findOrganizationById(db, membership.organizationId)
    : null;

  if (!membership || !membership.active || !organization) {
    // Never keep a usable session for an account without an active membership.
    await auth.api.signOut({ headers: request.headers }).catch(() => undefined);
    throw new ForbiddenError(
      "Akun ini tidak memiliki akses aktif pada instalasi lokal ini. Hubungi administrator panti.",
    );
  }

  await recordAudit(db, {
    organizationId: organization.id,
    actor: { type: "staff", membershipId: membership.id },
    action: "auth.login",
    entityType: "session",
    entityId: null,
    metadata: { role: membership.role },
  });

  const response = jsonOk({
    user: signedInUser,
    membership: {
      id: membership.id,
      role: membership.role,
      credentialVerifiedAt: membership.credentialVerifiedAt,
    },
    organization: {
      id: organization.id,
      name: organization.name,
      timezone: organization.timezone,
    },
    permissions: permissionsForRole(membership.role),
  });
  response.cookies.set("panti.intake", "", { path: "/", maxAge: 0, expires: new Date(0) });
  return response;
});
