import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

// Ces deux migrations sont additives et réexécutables (IF NOT EXISTS).
export const DATABASE_MIGRATIONS = [
  "001_llm_configuration.sql",
  "002_expert_llm_configuration.sql",
] as const;

export async function applyDatabaseMigrations(
  pool: Pool,
): Promise<readonly string[]> {
  const client = await pool.connect();
  try {
    for (const filename of DATABASE_MIGRATIONS) {
      const sql = await readFile(
        new URL(`../../db/migrations/${filename}`, import.meta.url),
        "utf8",
      );
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return DATABASE_MIGRATIONS;
  } finally {
    client.release();
  }
}
