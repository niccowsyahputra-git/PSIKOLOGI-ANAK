import { ValidationError } from "./errors";
import { DEFINITION_MAX_BYTES } from "./assessment-builder/definition";

/** Enforce the byte budget while streaming, including requests without Content-Length. */
export async function boundedJson(request: Request, limit = DEFINITION_MAX_BYTES + 4096): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new ValidationError("Permintaan terlalu besar.");
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError("JSON diperlukan.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ValidationError("Permintaan terlalu besar."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ValidationError("JSON tidak valid."); }
}
