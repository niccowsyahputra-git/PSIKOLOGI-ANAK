export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store", headers: data instanceof FormData ? undefined : { "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: data instanceof FormData ? data : JSON.stringify(data) }) });
  const json = await response.json();
  if (!response.ok) { const error = new Error(json.error?.message || "Server tidak dapat menyimpan data") as Error & { status: number }; error.status = response.status; throw error; }
  return json.data as T;
}
