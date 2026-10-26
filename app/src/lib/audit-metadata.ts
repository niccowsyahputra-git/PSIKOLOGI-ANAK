/**
 * Audit metadata must stay limited to identifiers and field names
 * (FR-16, section 12.4). Anything that could carry participant text, contact
 * details or credentials is dropped before it reaches `audit_logs`.
 */
const SAFE_KEY_SUFFIXES = [
  "Id",
  "Ids",
  "Field",
  "Fields",
  "Status",
  "State",
  "Revision",
  "Version",
  "Count",
  "Type",
  "Code",
  "Reason",
  "Action",
  "Role",
  "Active",
  "Origin",
  "Scope",
  "Mode",
  "Result",
] as const;

const DENIED_KEY_PATTERN =
  /(name|email|token|secret|key|password|answer|text|note|contact|birth|phone|address|content|value|summary|narrative|observation)/i;

export type SafeAuditMetadata = Record<string, string | number | boolean | null>;

const MAX_STRING_LENGTH = 120;

export function isSafeAuditKey(key: string): boolean {
  if (DENIED_KEY_PATTERN.test(key)) return false;
  // Domain services write camelCase keys such as `role` or `previousRole`; the
  // suffix list is capitalised, so match against the capitalised form.
  const normalised = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  return SAFE_KEY_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}

export function sanitizeAuditMetadata(
  input: Record<string, unknown> | undefined,
): SafeAuditMetadata {
  if (!input) return {};
  const safe: SafeAuditMetadata = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isSafeAuditKey(key)) continue;
    if (value === null) {
      safe[key] = null;
      continue;
    }
    if (typeof value === "boolean" || typeof value === "number") {
      safe[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (value.length === 0 || value.length > MAX_STRING_LENGTH) continue;
      safe[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      safe[key] = value.slice(0, 20).join(",").slice(0, MAX_STRING_LENGTH);
    }
  }
  return safe;
}

export function serializeAuditMetadata(metadata: SafeAuditMetadata): string {
  return JSON.stringify(metadata);
}
