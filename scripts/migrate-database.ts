import { Pool } from "pg";
import "dotenv/config";
import { applyDatabaseMigrations } from "../src/database/migrations.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL est requis pour exécuter les migrations.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});

try {
  const applied = await applyDatabaseMigrations(pool);
  for (const filename of applied) {
    console.log(`Migration ${filename} appliquée.`);
  }
} finally {
  await pool.end();
}
