export async function builderRequest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await response.json();
  if (!response.ok) throw new Error(`${response.status === 409 ? "Konflik revisi. Muat ulang sebelum melanjutkan. " : ""}${json.error?.message ?? "Permintaan gagal"}${json.error?.fieldErrors ? " · " + Object.entries(json.error.fieldErrors).map(([key, value]) => `${key}: ${String(value)}`).join("; ") : ""}`);
  return json.data as T;
}
