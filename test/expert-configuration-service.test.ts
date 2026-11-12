import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { ExpertConfigurationService } from "../src/configuration/expert-configuration-service.js";
import type { ChangeExpertConfigurationInput } from "../src/configuration/expert-configuration.js";
import type { ExpertIntention } from "../src/configuration/expert-definitions.js";
import { EXPERT_PROVIDER_NAMES } from "../src/configuration/expert-definitions.js";
import type { LlmConfigurationRepository } from "../src/configuration/llm-configuration-repository.js";
import type {
  SaveLlmConfiguration,
  StoredLlmConfiguration,
} from "../src/configuration/llm-configuration.js";
import { LlmConfigurationService } from "../src/configuration/llm-configuration-service.js";
import { ApiKeyCipher } from "../src/security/api-key-cipher.js";

class MemoryRepository implements LlmConfigurationRepository {
  readonly rows = new Map<number, StoredLlmConfiguration>();

  async findByInstallationId(id: number) {
    return this.rows.get(id) ?? null;
  }

  async upsert(input: SaveLlmConfiguration) {
    const row = {
      ...input,
      createdAt: this.rows.get(input.installationId)?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(input.installationId, row);
    return row;
  }

  async delete(id: number) {
    return this.rows.delete(id);
  }
}

const input: ChangeExpertConfigurationInput = {
  installationId: 42,
  intention: "bug",
  provider: "openai",
  model: "model-test",
  apiKey: "fake-api-key-1234",
  githubUserId: 7,
};

function setup() {
  const repository = new MemoryRepository();
  const factory = vi.fn(() => repository);
  const cipher = new ApiKeyCipher(Buffer.alloc(32, 9).toString("base64"));
  const service = new ExpertConfigurationService(factory, cipher);
  return { repository, factory, cipher, service };
}

// Aucun accès réseau : tous les adaptateurs utilisent ce fetch simulé. Les
// enveloppes des trois API sont présentes pour le test de connexion partagé.
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK" } }],
          content: [{ type: "text", text: "OK" }],
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ExpertConfigurationService", () => {
  it("délègue le nettoyage global, valide les identifiants et filtre les erreurs", async () => {
    const { repository, cipher } = setup();
    const cleanup = vi.fn().mockResolvedValue(2);
    const service = new ExpertConfigurationService(
      () => repository,
      cipher,
      cleanup,
    );
    expect(await service.deleteForInstallation(42, 7)).toBe(2);
    expect(cleanup).toHaveBeenCalledWith(42, 7);
    await expect(service.deleteForInstallation(0)).rejects.toThrow(
      "entier positif",
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    cleanup.mockRejectedValue(new Error("fake-secret-db-error"));
    await expect(service.deleteForInstallation(42)).rejects.toThrow(
      "Impossible de supprimer les configurations",
    );
    await expect(
      new ExpertConfigurationService(
        () => repository,
        cipher,
      ).deleteForInstallation(42),
    ).rejects.toThrow("Impossible de supprimer les configurations");
  });

  it.each(EXPERT_PROVIDER_NAMES)(
    "teste, chiffre et résout une configuration %s",
    async (provider) => {
      const { repository, factory, cipher, service } = setup();
      const summary = await service.save({ ...input, provider });
      const stored = repository.rows.get(42)!;

      expect(factory).toHaveBeenCalledWith("bug");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(cipher.decrypt(stored.encryptedApiKey)).toBe(input.apiKey);
      expect(JSON.stringify(stored)).not.toContain(input.apiKey);
      expect(summary).toEqual({
        installationId: 42,
        intention: "bug",
        provider,
        model: "model-test",
        baseUrl: undefined,
        keyLastFour: "1234",
        updatedByGithubUserId: 7,
        updatedAt: expect.any(Date),
      });
      expect(await service.getSummary(42, "bug")).toEqual(summary);
      expect(summary).not.toHaveProperty("apiKey");
      expect(summary).not.toHaveProperty("encryptedApiKey");
      expect(await service.resolve(42, "bug")).toEqual({
        installationId: 42,
        intention: "bug",
        provider,
        model: "model-test",
        apiKey: input.apiKey,
        baseUrl: undefined,
      });
    },
  );

  it("teste sans enregistrer et utilise la clé existante si elle est omise", async () => {
    const { repository, service } = setup();
    await service.test(input);
    expect(repository.rows.size).toBe(0);
    await service.save(input);
    const before = repository.rows.get(42);
    await service.test({ ...input, model: "another-model", apiKey: undefined });
    expect(repository.rows.get(42)).toBe(before);
    const options = fetchMock.mock.calls.at(-1)![1] as RequestInit;
    expect(options.headers).toMatchObject({
      Authorization: `Bearer ${input.apiKey}`,
    });
    expect(JSON.parse(options.body as string).model).toBe("another-model");
  });

  it("conserve la clé et le créateur lors d'un changement de modèle", async () => {
    const { repository, service } = setup();
    await service.save(input);
    const before = repository.rows.get(42)!;
    await service.save({
      ...input,
      apiKey: undefined,
      model: "new-model",
      githubUserId: 8,
    });
    const after = repository.rows.get(42)!;
    expect(after.encryptedApiKey).toEqual(before.encryptedApiKey);
    expect(after.createdByGithubUserId).toBe(7);
    expect(after.updatedByGithubUserId).toBe(8);
    expect((await service.resolve(42, "bug"))?.model).toBe("new-model");
  });

  it("normalise le modèle et la clé via le service existant", async () => {
    const { service } = setup();
    await service.save({
      ...input,
      apiKey: ` ${input.apiKey} `,
      model: " model-trimmed ",
    });
    expect(await service.resolve(42, "bug")).toMatchObject({
      apiKey: input.apiKey,
      model: "model-trimmed",
    });
  });

  it("exige une clé initiale et une nouvelle clé pour changer de fournisseur", async () => {
    const { service } = setup();
    await expect(service.save({ ...input, apiKey: undefined })).rejects.toThrow(
      "clé API est requise",
    );
    await service.save(input);
    await expect(
      service.save({ ...input, provider: "anthropic", apiKey: undefined }),
    ).rejects.toThrow("nouvelle clé API");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await service.save({
      ...input,
      provider: "anthropic",
      apiKey: "fake-claude-key-5678",
    });
    expect(await service.resolve(42, "bug")).toMatchObject({
      provider: "anthropic",
      apiKey: "fake-claude-key-5678",
    });
  });

  it("conserve la configuration après un test refusé et ne propage pas le secret réfléchi", async () => {
    const { repository, service } = setup();
    await service.save(input);
    const before = repository.rows.get(42);
    const newKey = "fake-rejected-key-9876";
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: `Invalid credentials ${newKey}` },
          }),
          { status: 401 },
        ),
    );
    for (const operation of [
      () => service.test({ ...input, apiKey: newKey }),
      () => service.save({ ...input, apiKey: newKey }),
    ]) {
      const error = await operation().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("401");
      expect(inspect(error)).not.toContain(newKey);
      expect(error).not.toHaveProperty("cause");
    }
    expect(repository.rows.get(42)).toBe(before);
  });

  it("ne propage pas les erreurs réseau contenant des identifiants", async () => {
    const { service } = setup();
    fetchMock.mockRejectedValue(
      new Error(`Request failed with ${input.apiKey}`),
    );
    const error = await service.test(input).catch((reason: unknown) => reason);
    expect(inspect(error)).not.toContain(input.apiKey);
    expect((error as Error).message).toContain("Impossible de tester");
  });

  it("isole les installations et la configuration du classifieur", async () => {
    const { service, cipher } = setup();
    const classifier = new LlmConfigurationService(
      new MemoryRepository(),
      cipher,
    );
    await classifier.save({
      ...input,
      provider: "groq",
      model: "classifier-model",
    });
    await service.save(input);
    await service.save({ ...input, installationId: 43, model: "second-model" });
    expect((await service.resolve(42, "bug"))?.model).toBe("model-test");
    expect((await service.resolve(43, "bug"))?.model).toBe("second-model");
    expect(await service.delete(42, "bug", 7)).toBe(true);
    expect(await service.getSummary(42, "bug")).toBeNull();
    expect(await service.resolve(42, "bug")).toBeNull();
    expect(await service.delete(42, "bug", 7)).toBe(false);
    expect((await service.resolve(43, "bug"))?.model).toBe("second-model");
    expect((await classifier.resolve(42))?.model).toBe("classifier-model");
  });

  it("retourne null uniquement si le repository ne contient aucune configuration", async () => {
    const { service, repository } = setup();
    expect(await service.resolve(42, "bug")).toBeNull();
    vi.spyOn(repository, "findByInstallationId").mockRejectedValue(
      new Error("database offline"),
    );
    await expect(service.resolve(42, "bug")).rejects.toThrow(
      "Impossible de résoudre",
    );
    await expect(service.getSummary(42, "bug")).rejects.toThrow(
      "Impossible de lire",
    );
  });

  it("signale un chiffrement corrompu sans retourner null ou exposer la clé", async () => {
    const { service, repository } = setup();
    await service.save(input);
    repository.rows.get(42)!.encryptedApiKey.authTag =
      Buffer.alloc(16).toString("base64");
    await expect(service.resolve(42, "bug")).rejects.toThrow(
      "Impossible de résoudre",
    );
  });

  it("ne conserve pas les configurations en cache et transmet l'auteur de suppression", async () => {
    const { service, repository } = setup();
    await service.save(input);
    await service.resolve(42, "bug");
    repository.rows.get(42)!.model = "changed-outside-service";
    expect((await service.resolve(42, "bug"))?.model).toBe(
      "changed-outside-service",
    );
    const remove = vi.spyOn(repository, "delete");
    await service.delete(42, "bug", 9);
    expect(remove).toHaveBeenCalledWith(42, 9);
  });

  it("refuse une intention inactive sur toutes les opérations", async () => {
    const { service, factory } = setup();
    const intention = "refactor" as ExpertIntention;
    for (const operation of [
      () => service.getSummary(42, intention),
      () => service.resolve(42, intention),
      () => service.delete(42, intention),
      () => service.test({ ...input, intention }),
      () => service.save({ ...input, intention }),
    ]) {
      await expect(operation()).rejects.toThrow("pas configurable");
    }
    expect(factory).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "groq" },
    { installationId: 0 },
    { installationId: Number.MAX_SAFE_INTEGER + 1 },
    { githubUserId: -1 },
    { model: "x".repeat(161) },
    { apiKey: "x".repeat(4097) },
    { baseUrl: "https://custom.example/v1" },
  ])(
    "refuse les paramètres invalides avant tout accès externe : %j",
    async (changes) => {
      const { service, factory } = setup();
      await expect(
        service.save({
          ...input,
          ...changes,
        } as ChangeExpertConfigurationInput),
      ).rejects.toThrow();
      expect(factory).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuse une configuration persistée avec un fournisseur non autorisé", async () => {
    const { service, repository } = setup();
    await service.save(input);
    repository.rows.get(42)!.provider = "groq";
    await expect(service.resolve(42, "bug")).rejects.toThrow(
      "Impossible de résoudre",
    );
    await expect(service.getSummary(42, "bug")).rejects.toThrow(
      "Impossible de lire",
    );
  });
});
