/**
 * Database client (postgres.js + Drizzle). One pool per process, cached on globalThis so Next.js
 * dev HMR doesn't leak connections. Created lazily on first use.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
/** Either the root db or a transaction handle. */
export type DbExecutor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;

interface DbGlobal {
  __sf6Sql?: Sql;
  __sf6Db?: Database;
}
const g = globalThis as DbGlobal;

export function getSql(): Sql {
  if (!g.__sf6Sql) {
    const env = getEnv();
    g.__sf6Sql = postgres(env.DATABASE_URL, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return g.__sf6Sql;
}

export function getDb(): Database {
  if (!g.__sf6Db) g.__sf6Db = drizzle(getSql(), { schema });
  return g.__sf6Db;
}

export async function closeDb(): Promise<void> {
  const sql = g.__sf6Sql;
  g.__sf6Sql = undefined;
  g.__sf6Db = undefined;
  await sql?.end({ timeout: 5 });
}
