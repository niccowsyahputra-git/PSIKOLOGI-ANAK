/**
 * Config entry used only by `@better-auth/cli generate` to emit
 * `src/lib/db/auth-schema.ts`. It reuses the runtime options so the generated
 * schema cannot drift from `src/lib/auth.ts`.
 *
 *   npm run db:generate-auth-schema
 */
import { betterAuth } from "better-auth";
import { createAuthOptions } from "../src/lib/auth";

export const auth = betterAuth(createAuthOptions());
export default auth;
