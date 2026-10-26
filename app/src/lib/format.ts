/**
 * Display helpers. Dates are always rendered in the organisation time zone
 * (default Asia/Jakarta) so printed records match the local clock.
 */
const dateTimeFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = dateTimeFormatter.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  dateTimeFormatter.set(timeZone, formatter);
  return formatter;
}

export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone = "Asia/Jakarta",
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatterFor(timeZone).format(date);
}

export function formatDate(
  value: Date | string | null | undefined,
  timeZone = "Asia/Jakarta",
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeZone,
  }).format(date);
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
