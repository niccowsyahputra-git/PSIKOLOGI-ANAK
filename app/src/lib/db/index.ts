import { chmodSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { getEnv } from "../env";
import { ensurePrivateDirectory } from "../paths";
import * as schema from "./schema";

/**
 * One SQLite/libSQL file client for the whole local application (DEC-02,
 * section 20.2). Nothing here may fall back to a remote Turso URL: `getEnv()`
 * rejects any non-`file:` DATABASE_URL while LOCAL_ONLY=true.
 */
export type AppDatabase = LibSQLDatabase<typeof schema>;

let client: Client | null = null;
let database: AppDatabase | null = null;
let pragmasPromise: Promise<void> | null = null;

function prepareDatabaseFile(databaseAbsolutePath: string): void {
  // The directory must be owner-only and the file itself must not be readable by
  // other local accounts (section 12.4). SQLite creates the WAL/SHM siblings
  // with the same permissions as the database file.
  ensurePrivateDirectory(path.dirname(databaseAbsolutePath));
  // The main file and its WAL/SHM siblings all hold participant data.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      chmodSync(`${databaseAbsolutePath}${suffix}`, 0o600);
    } catch {
      // The file does not exist yet on a fresh install; the next open creates it.
    }
  }
}

async function applyPragmas(sqliteClient: Client): Promise<void> {
  // FOREIGN KEY enforcement is per connection in SQLite, so it is applied once
  // when the single local connection is opened. `journal_mode` cannot change
  // inside a transaction, so the PRAGMAs run one by one instead of as a batch.
  await sqliteClient.execute("PRAGMA foreign_keys = ON");
  await sqliteClient.execute("PRAGMA journal_mode = WAL");
  await sqliteClient.execute("PRAGMA busy_timeout = 5000");
}

export function getDb(): AppDatabase {
  if (database === null) {
    const env = getEnv();
    prepareDatabaseFile(env.database.absolutePath);
    client = createClient({ url: env.database.url });
    pragmasPromise = applyPragmas(client);
    database = drizzle(client, { schema });
  }
  return database;
}

/**
 * Services that must not read before `PRAGMA foreign_keys` is applied await this
 * once per process. Kept separate from `getDb()` so repositories can stay sync.
 */
export async function getDbReady(): Promise<AppDatabase> {
  const db = getDb();
  if (pragmasPromise !== null) {
    await pragmasPromise;
  }
  return db;
}

export function getDbClient(): Client {
  if (client === null) {
    getDb();
  }
  if (client === null) {
    throw new Error("Database client could not be created");
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (pragmasPromise !== null) {
    await pragmasPromise.catch(() => undefined);
  }
  if (client !== null) {
    client.close();
  }
  client = null;
  database = null;
  pragmasPromise = null;
}

/** Test helper: points the module at a fresh file after DATABASE_URL changes. */
export async function resetDbForTests(): Promise<void> {
  await closeDb();
}
