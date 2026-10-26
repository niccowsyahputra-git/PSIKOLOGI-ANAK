import { randomUUID } from "node:crypto";
import { NextResponse, connection } from "next/server";
import { ZodError } from "zod";
import {
  DomainError,
  UnauthenticatedError,
  ValidationError,
} from "./errors";
import { PermissionDeniedError } from "./permissions";

/**
 * PRD section 10: success `{ data, meta? }`, error `{ error: { code, message,
 * fieldErrors?, requestId } }`. Messages are sanitized; stack traces and driver
 * errors never leave the server.
 */
export type ApiSuccess<TData, TMeta = undefined> = {
  data: TData;
  meta?: TMeta;
};

export type ApiFailure = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    requestId: string;
  };
};

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

export function jsonOk<TData, TMeta>(
  data: TData,
  options?: { meta?: TMeta; status?: number; headers?: Record<string, string> },
): NextResponse<ApiSuccess<TData, TMeta>> {
  const body: ApiSuccess<TData, TMeta> = options?.meta
    ? { data, meta: options.meta }
    : { data };
  return NextResponse.json(body, {
    status: options?.status ?? 200,
    headers: { ...PRIVATE_HEADERS, ...options?.headers },
  });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  options?: {
    fieldErrors?: Record<string, string[]>;
    requestId?: string;
    headers?: Record<string, string>;
  },
): NextResponse<ApiFailure> {
  const body: ApiFailure = {
    error: {
      code,
      message,
      requestId: options?.requestId ?? randomUUID(),
      ...(options?.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
    },
  };
  return NextResponse.json(body, {
    status,
    headers: { ...PRIVATE_HEADERS, ...options?.headers },
  });
}

export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    const bucket = fieldErrors[key] ?? [];
    bucket.push(issue.message);
    fieldErrors[key] = bucket;
  }
  return fieldErrors;
}

function logServerError(requestId: string, error: unknown): void {
  const safeDetails =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : "Unknown error type";
  console.error(`[api:${requestId}] ${safeDetails}`);
}

/**
 * Wraps a route handler so every failure becomes a sanitized envelope. Unknown
 * errors are logged with a request id and answered as INTERNAL.
 */
export function withApiHandler<RequestType extends Request, Args extends unknown[]>(
  handler: (request: RequestType, ...args: Args) => Promise<Response>,
): (request: RequestType, ...args: Args) => Promise<Response> {
  return async (request: RequestType, ...args: Args) => {
    const requestId = randomUUID();
    // API routes depend on the session cookie on every call, so they must never
    // be prerendered into the static shell (Cache Components).
    await connection();
    try {
      const response = await handler(request, ...args);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      if (error instanceof ValidationError) {
        return jsonError(error.status, error.code, error.message, {
          fieldErrors: error.fieldErrors,
          requestId,
        });
      }
      if (error instanceof ZodError) {
        return jsonError(422, "VALIDATION", "Data yang dikirim tidak valid", {
          fieldErrors: zodFieldErrors(error),
          requestId,
        });
      }
      if (error instanceof PermissionDeniedError) {
        return jsonError(403, "FORBIDDEN", "Peran Anda tidak diizinkan untuk tindakan ini", {
          requestId,
        });
      }
      if (error instanceof DomainError) {
        return jsonError(error.status, error.code, error.message, { requestId });
      }
      logServerError(requestId, error);
      return jsonError(
        500,
        "INTERNAL",
        "Terjadi kesalahan pada server lokal. Periksa log server.",
        { requestId },
      );
    }
  };
}

export function unauthenticatedResponse(): NextResponse<ApiFailure> {
  return jsonError(
    new UnauthenticatedError().status,
    "UNAUTHENTICATED",
    new UnauthenticatedError().message,
  );
}
