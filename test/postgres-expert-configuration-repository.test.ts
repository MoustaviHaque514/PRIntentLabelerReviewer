import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresExpertConfigurationRepository } from "../src/configuration/postgres-expert-configuration-repository.js";
import type { ExpertIntention } from "../src/configuration/expert-definitions.js";
import type { SaveLlmConfiguration } from "../src/configuration/llm-configuration.js";

const input: SaveLlmConfiguration = {
  installationId: 42,
  provider: "anthropic",
  model: "model-test",
  encryptedApiKey: {
    ciphertext: "encrypted-value",
    iv: "iv-value",
    authTag: "tag-value",
  },
  keyLastFour: "1234",
  createdByGithubUserId: 7,
  updatedByGithubUserId: 8,
};

const row = {
  installation_id: "42",
  provider: "anthropic",
  model: "model-test",
  encrypted_api_key: "encrypted-value",
  encryption_iv: "iv-value",
  encryption_auth_tag: "tag-value",
  key_last_four: "1234",
  base_url: null,
  created_by_github_user_id: "7",
  updated_by_github_user_id: "8",
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-02T00:00:00Z"),
};

const empty = () => ({ rows: [], rowCount: 0 });
const found = () => ({ rows: [{ ...row }], rowCount: 1 });

function setup() {
  const client = {
    query: vi.fn().mockResolvedValue(empty()),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue(empty()),
    connect: vi.fn().mockResolvedValue(client),
  };
  const repository = new PostgresExpertConfigurationRepository(
    pool as unknown as Pool,
    "bug",
  );
  return { repository, pool, client };
}

describe("PostgresExpertConfigurationRepository (client PostgreSQL simulé)", () => {
  it("supprime toutes les intentions de l'installation et les audite dans une seule instruction atomique", async () => {
    const { pool } = setup();
    pool.query.mockResolvedValueOnce({
      rows: [{ deleted_count: 3 }],
      rowCount: 1,
    });
    expect(
      await PostgresExpertConfigurationRepository.deleteForInstallation(
        pool as unknown as Pool,
        42,
      ),
    ).toBe(3);
    expect(pool.query).toHaveBeenCalledOnce();
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual([42, null]);
    expect(sql).toMatch(
      /DELETE FROM expert_llm_configurations\s+WHERE installation_id = \$1\s+RETURNING installation_id, intention, provider, model/,
    );
    expect(sql).toContain("INSERT INTO expert_llm_configuration_audits");
    expect(sql).toContain("FROM deleted");
    expect(sql).not.toContain("encrypted_api_key");
    expect(sql).not.toContain("intention =");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("rend le nettoyage répétable et propage les échecs de l'instruction atomique", async () => {
    const { pool } = setup();
    pool.query.mockResolvedValueOnce({
      rows: [{ deleted_count: 0 }],
      rowCount: 1,
    });
    expect(
      await PostgresExpertConfigurationRepository.deleteForInstallation(
        pool as unknown as Pool,
        42,
        7,
      ),
    ).toBe(0);
    expect(pool.query).toHaveBeenLastCalledWith(expect.any(String), [42, 7]);
    pool.query.mockRejectedValueOnce(new Error("audit failed"));
    await expect(
      PostgresExpertConfigurationRepository.deleteForInstallation(
        pool as unknown as Pool,
        42,
      ),
    ).rejects.toThrow("audit failed");
  });

  it("lie la lecture à l'installation et à l'intention et reconstitue les champs chiffrés", async () => {
    const { repository, pool } = setup();
    pool.query.mockResolvedValueOnce(found());
    expect(await repository.findByInstallationId(42)).toEqual({
      ...input,
      baseUrl: undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /FROM expert_llm_configurations\s+WHERE installation_id = \$1 AND intention = \$2/,
      ),
      [42, "bug"],
    );
    expect(await repository.findByInstallationId(43)).toBeNull();
    expect(pool.query).toHaveBeenLastCalledWith(expect.any(String), [
      43,
      "bug",
    ]);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("insère et audite dans une seule transaction sans inclure les secrets dans l'audit", async () => {
    const { repository, client } = setup();
    client.query.mockResolvedValueOnce(empty()).mockResolvedValueOnce(found());
    const saved = await repository.upsert(input);
    expect(saved.createdByGithubUserId).toBe(7);
    expect(client.query.mock.calls[0]).toEqual(["BEGIN"]);
    expect(client.query.mock.calls[1]).toEqual([
      expect.stringContaining(
        "ON CONFLICT (installation_id, intention) DO NOTHING",
      ),
      [
        42,
        "bug",
        "anthropic",
        "model-test",
        "encrypted-value",
        "iv-value",
        "tag-value",
        "1234",
        null,
        7,
        8,
      ],
    ]);
    expect(client.query.mock.calls[2]).toEqual([
      expect.stringContaining("INSERT INTO expert_llm_configuration_audits"),
      [42, "bug", "created", "anthropic", "model-test", 8],
    ]);
    expect(JSON.stringify(client.query.mock.calls[2])).not.toContain(
      "encrypted-value",
    );
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("met à jour uniquement le couple ciblé et préserve l'auteur et la date de création", async () => {
    const { repository, client } = setup();
    client.query
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(found());
    const saved = await repository.upsert({
      ...input,
      createdByGithubUserId: 999,
    });
    expect(saved.createdByGithubUserId).toBe(7);
    expect(saved.createdAt).toEqual(row.created_at);
    const [sql, params] = client.query.mock.calls[2];
    expect(sql).toMatch(/WHERE installation_id = \$1 AND intention = \$2/);
    const assignments = sql.split("WHERE")[0];
    expect(assignments).not.toContain("created_by_github_user_id");
    expect(assignments).not.toContain("created_at");
    expect(params).toEqual([
      42,
      "bug",
      "anthropic",
      "model-test",
      "encrypted-value",
      "iv-value",
      "tag-value",
      "1234",
      null,
      8,
    ]);
    expect(client.query.mock.calls[3][1]).toEqual([
      42,
      "bug",
      "updated",
      "anthropic",
      "model-test",
      8,
    ]);
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("paramètre le modèle sans l'interpoler dans le SQL", async () => {
    const { repository, client } = setup();
    client.query.mockResolvedValueOnce(empty()).mockResolvedValueOnce(found());
    const model = "model'; DELETE FROM llm_configurations; --";
    await repository.upsert({ ...input, model });
    const [sql, params] = client.query.mock.calls[1];
    expect(sql).not.toContain(model);
    expect(params[3]).toBe(model);
  });

  it("annule l'écriture si l'audit échoue et libère le client", async () => {
    const { repository, client } = setup();
    client.query
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(found())
      .mockRejectedValueOnce(new Error("audit failed"));
    await expect(repository.upsert(input)).rejects.toThrow("audit failed");
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("annule en cas d'échec d'insertion", async () => {
    const { repository, client } = setup();
    client.query
      .mockResolvedValueOnce(empty())
      .mockRejectedValueOnce(new Error("insert failed"));
    await expect(repository.upsert(input)).rejects.toThrow("insert failed");
    expect(client.query.mock.calls).toHaveLength(3);
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("refuse d'auditer une mise à jour qui n'a plus de ligne cible", async () => {
    const { repository, client } = setup();
    await expect(repository.upsert(input)).rejects.toThrow("supprimée pendant");
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(
      client.query.mock.calls.some(([sql]) =>
        sql.includes("INSERT INTO expert_llm_configuration_audits"),
      ),
    ).toBe(false);
  });

  it("supprime et audite uniquement le couple demandé", async () => {
    const { repository, client } = setup();
    client.query.mockResolvedValueOnce(empty()).mockResolvedValueOnce(found());
    expect(await repository.delete(42, 9)).toBe(true);
    expect(client.query.mock.calls[1]).toEqual([
      expect.stringMatching(
        /DELETE FROM expert_llm_configurations\s+WHERE installation_id = \$1 AND intention = \$2/,
      ),
      [42, "bug"],
    ]);
    expect(client.query.mock.calls[2][1]).toEqual([
      42,
      "bug",
      "deleted",
      "anthropic",
      "model-test",
      9,
    ]);
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("ne crée pas d'audit pour une suppression sans ligne", async () => {
    const { repository, client } = setup();
    expect(await repository.delete(42)).toBe(false);
    expect(client.query.mock.calls).toHaveLength(3);
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("annule la suppression si son audit échoue", async () => {
    const { repository, client } = setup();
    client.query
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(found())
      .mockRejectedValueOnce(new Error("audit failed"));
    await expect(repository.delete(42)).rejects.toThrow("audit failed");
    expect(client.query.mock.calls[2][1]).toEqual([
      42,
      "bug",
      "deleted",
      "anthropic",
      "model-test",
      null,
    ]);
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("refuse les intentions et fournisseurs non autorisés", async () => {
    const { repository, pool } = setup();
    expect(
      () =>
        new PostgresExpertConfigurationRepository(
          pool as unknown as Pool,
          "refactor" as ExpertIntention,
        ),
    ).toThrow("pas configurable");
    await expect(
      repository.upsert({ ...input, provider: "groq" }),
    ).rejects.toThrow("pas autorisé");
    expect(pool.connect).not.toHaveBeenCalled();
    pool.query.mockResolvedValueOnce({ rows: [{ ...row, provider: "groq" }] });
    await expect(repository.findByInstallationId(42)).rejects.toThrow(
      "pas autorisé",
    );
  });
});
