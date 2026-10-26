import { notFound } from "next/navigation";
import { NotFoundError } from "./errors";

/** Maps domain 404s from services to the Next.js not-found page; other errors propagate. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try { return await promise; } catch (error) { if (error instanceof NotFoundError) notFound(); throw error; }
}
