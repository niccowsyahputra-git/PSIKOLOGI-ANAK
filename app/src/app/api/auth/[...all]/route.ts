import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

/**
 * Better Auth owns `/api/auth/*` (session, sign-out, future credential
 * management). Public sign-up is disabled in `src/lib/auth.ts`, so this route
 * cannot be used to create accounts.
 */
let handler: ReturnType<typeof toNextJsHandler> | null = null;

function getHandler(): ReturnType<typeof toNextJsHandler> {
  if (handler === null) {
    handler = toNextJsHandler(getAuth().handler);
  }
  return handler;
}

export function GET(request: Request): Promise<Response> {
  return getHandler().GET(request);
}

export function POST(request: Request): Promise<Response> {
  return getHandler().POST(request);
}
