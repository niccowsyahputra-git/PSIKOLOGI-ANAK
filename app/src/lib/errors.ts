/**
 * Domain errors carry a stable code and an HTTP status so route handlers can
 * answer with the PRD section 10 envelope without leaking internals.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = "Sesi tidak valid atau sudah berakhir") {
    super("UNAUTHENTICATED", message, 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Peran Anda tidak diizinkan untuk tindakan ini") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Data tidak ditemukan") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message = "Data bertentangan dengan kondisi saat ini") {
    super("CONFLICT", message, 409);
  }
}

export class ValidationError extends DomainError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    message = "Data yang dikirim tidak valid",
    fieldErrors: Record<string, string[]> = {},
  ) {
    super("VALIDATION", message, 422);
    this.fieldErrors = fieldErrors;
  }
}

export class RateLimitError extends DomainError {
  constructor(message = "Terlalu banyak percobaan, coba lagi nanti") {
    super("RATE_LIMITED", message, 429);
  }
}

export class NotReadyError extends DomainError {
  constructor(message = "Fitur ini belum siap digunakan pada konfigurasi saat ini") {
    super("NOT_READY", message, 503);
  }
}

export class ConfigurationFailureError extends DomainError {
  constructor(message = "Konfigurasi lokal belum lengkap") {
    super("NOT_READY", message, 503);
  }
}
