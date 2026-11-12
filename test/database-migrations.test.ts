import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  applyDatabaseMigrations,
  DATABASE_MIGRATIONS,
} from "../src/database/migrations.js";

function setup() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  return { client, pool: pool as unknown as Pool };
}

describe("migrations (aucune connexion PostgreSQL réelle)", () => {
  it("lit les deux migrations du dépôt et les exécute dans l'ordre avec une transaction chacune", async () => {
    const { pool, client } = setup();
    const sql = await Promise.all(
      DATABASE_MIGRATIONS.map((filename) =>
        readFile(
          new URL(`../db/migrations/${filename}`, import.meta.url),
          "utf8",
        ),
      ),
    );
    expect(await applyDatabaseMigrations(pool)).toEqual([
      "001_llm_configuration.sql",
      "002_expert_llm_configuration.sql",
    ]);
    expect(client.query.mock.calls).toEqual([
      ["BEGIN"],
      [sql[0]],
      ["COMMIT"],
      ["BEGIN"],
      [sql[1]],
      ["COMMIT"],
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("annule une migration échouée et n'exécute pas la suivante", async () => {
    const { pool, client } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("DDL failed"));
    await expect(applyDatabaseMigrations(pool)).rejects.toThrow("DDL failed");
    expect(client.query.mock.calls).toHaveLength(3);
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("annule la seconde migration si elle échoue après la première", async () => {
    const { pool, client } = setup();
    client.query.mockImplementation(async (sql: string) => {
      if (
        sql.startsWith("CREATE TABLE IF NOT EXISTS expert_llm_configurations")
      ) {
        throw new Error("expert DDL failed");
      }
      return { rows: [] };
    });
    await expect(applyDatabaseMigrations(pool)).rejects.toThrow(
      "expert DDL failed",
    );
    expect(
      client.query.mock.calls.filter(([sql]) => sql === "COMMIT"),
    ).toHaveLength(1);
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("ajoute uniquement les tables d'experts sans dépendre d'une configuration du classifieur", async () => {
    const sql = await readFile(
      new URL(
        "../db/migrations/002_expert_llm_configuration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain("PRIMARY KEY (installation_id, intention)");
    expect(sql).toContain("provider IN ('anthropic', 'openai', 'gemini')");
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS expert_llm_configuration_audits",
    );
    expect(sql).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE|ALTER|REFERENCES)\b/i);
    expect(sql).not.toMatch(/\bllm_configurations\b/);
    // L'activation des intentions est dans le registre applicatif, pas dans
    // une contrainte SQL limitée à bug : les intentions futures réutilisent la table.
    expect(sql).not.toMatch(/intention\s+IN\s*\(/i);
  });
});
