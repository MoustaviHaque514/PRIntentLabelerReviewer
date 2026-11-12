import express from "express";
import type { Server } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerConfigurationRoutes } from "../src/http/configuration-routes.js";
import { getGitHubOAuthService } from "../src/auth/runtime.js";
import { getExpertConfigurationService } from "../src/configuration/expert-configuration-runtime.js";
import { getLlmConfigurationService } from "../src/configuration/runtime.js";
import { ExpertConfigurationService } from "../src/configuration/expert-configuration-service.js";
import { ExpertConfigurationUnavailableError } from "../src/configuration/expert-configuration.js";
import { ApiKeyCipher } from "../src/security/api-key-cipher.js";
import type {
  SaveLlmConfiguration,
  StoredLlmConfiguration,
} from "../src/configuration/llm-configuration.js";
import { EXPERT_PROVIDER_NAMES } from "../src/configuration/expert-definitions.js";
import { providerResponse } from "./fixtures/bug-review.js";

vi.mock("../src/auth/runtime.js", () => ({ getGitHubOAuthService: vi.fn() }));
vi.mock("../src/configuration/expert-configuration-runtime.js", () => ({
  getExpertConfigurationService: vi.fn(),
}));
vi.mock("../src/configuration/runtime.js", () => ({
  getLlmConfigurationService: vi.fn(),
}));

const httpFetch = globalThis.fetch; // HTTP local uniquement ; les appels LLM sont simulés.
const session = {
  githubUserId: 7,
  githubLogin: "test-user",
  installationIds: [42],
  csrfToken: "csrf-test",
  expiresAt: new Date(Date.now() + 100000),
};
let server: Server;
let base: string;
let rows: Map<number, StoredLlmConfiguration>;
let service: ExpertConfigurationService;
const llmFetch = vi.fn();

beforeEach(async () => {
  vi.mocked(getGitHubOAuthService)
    .mockReset()
    .mockReturnValue({
      getSession: vi.fn(async () => session),
    } as unknown as NonNullable<ReturnType<typeof getGitHubOAuthService>>);
  rows = new Map();
  service = new ExpertConfigurationService(
    () => ({
      findByInstallationId: async (id) => rows.get(id) ?? null,
      upsert: async (input: SaveLlmConfiguration) => {
        const row = { ...input, createdAt: new Date(), updatedAt: new Date() };
        rows.set(input.installationId, row);
        return row;
      },
      delete: async (id) => rows.delete(id),
    }),
    new ApiKeyCipher(Buffer.alloc(32, 4).toString("base64")),
  );
  vi.mocked(getExpertConfigurationService).mockReset().mockReturnValue(service);
  vi.mocked(getLlmConfigurationService)
    .mockReset()
    .mockReturnValue({
      getSummary: vi.fn(async () => null),
    } as unknown as NonNullable<ReturnType<typeof getLlmConfigurationService>>);
  llmFetch.mockReset().mockImplementation(async (url: string) => {
    if (url.includes("anthropic")) {
      return providerResponse("anthropic", "OK");
    }
    if (url.includes("googleapis")) {
      return providerResponse("gemini", "OK");
    }
    return providerResponse("openai", "OK");
  });
  vi.stubGlobal("fetch", llmFetch);
  const app = express();
  const router = express.Router();
  registerConfigurationRoutes(router);
  app.use(router);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function request(
  path: string,
  fields?: Record<string, string>,
  cookie = "pril_session=test-session",
) {
  return httpFetch(base + path, {
    redirect: "manual",
    headers: { Cookie: cookie },
    ...(fields ? { method: "POST", body: new URLSearchParams(fields) } : {}),
  });
}
const form = {
  _csrf: "csrf-test",
  provider: "openai",
  model: "test-model",
  apiKey: "fake-private-key-1234",
};
const path = "/settings/42/experts/bug";
const testPath = "/api/installations/42/experts/bug/llm/test";

describe("routes des experts avec vrai service et clients externes simulés", () => {
  it("affiche le lien et conserve le formulaire du classifieur", async () => {
    const response = await request("/settings/42");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(`href="${path}"`);
    expect(html).toContain('action="/settings/42/save"');
    expect(getExpertConfigurationService).not.toHaveBeenCalled();
  });

  it.each(EXPERT_PROVIDER_NAMES)(
    "teste, enregistre, relit, modifie et supprime %s",
    async (provider) => {
      const test = await request(testPath, { ...form, provider });
      expect(test.status).toBe(200);
      expect(rows.size).toBe(0);
      const saved = await request(`${path}/save`, { ...form, provider });
      expect(saved.status).toBe(302);
      expect(saved.headers.get("location")).toBe(`${path}?saved=1`);
      expect(JSON.stringify(rows.get(42))).not.toContain(form.apiKey);
      const page = await request(`${path}?saved=1`);
      const html = await page.text();
      expect(page.headers.get("cache-control")).toBe("no-store");
      expect(page.headers.get("content-security-policy")).toContain(
        "script-src 'self'",
      );
      expect(html).toContain("1234");
      expect(html).not.toContain(form.apiKey);
      expect(html).toContain("utilisée à la prochaine analyse");
      expect(html).not.toContain("activation à venir");
      const updated = await request(`${path}/save`, {
        ...form,
        provider,
        model: "new-model",
        apiKey: "",
      });
      expect(updated.status).toBe(302);
      expect(await service.resolve(42, "bug")).toMatchObject({
        provider,
        model: "new-model",
        apiKey: form.apiKey,
      });
      expect(
        (await request(`${path}/delete`, { _csrf: form._csrf })).status,
      ).toBe(302);
      expect(await service.resolve(42, "bug")).toBeNull();
    },
  );

  it("rejette une nouvelle clé sans remplacer l'ancienne ni la réafficher", async () => {
    await request(`${path}/save`, form);
    llmFetch.mockImplementation(async () =>
      Response.json(
        { error: { message: "fake-rejected-secret" } },
        { status: 401 },
      ),
    );
    const response = await request(`${path}/save`, {
      ...form,
      apiKey: "fake-rejected-secret",
    });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("401");
    expect(html).not.toContain("fake-rejected-secret");
    expect(html).not.toContain(form.apiKey);
    expect((await service.resolve(42, "bug"))?.apiKey).toBe(form.apiKey);
  });

  it.each([`${path}/save`, `${path}/delete`, testPath])(
    "protège %s contre les mutations sans CSRF",
    async (url) => {
      const response = await request(url, { ...form, _csrf: "invalid" });
      expect(response.status).toBe(403);
      expect(getExpertConfigurationService).not.toHaveBeenCalled();
      expect(llmFetch).not.toHaveBeenCalled();
    },
  );

  it("redirige un GET non connecté et refuse un POST non connecté", async () => {
    const response = await request(path, undefined, "");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/auth/github?installation_id=42",
    );
    expect((await request(testPath, form, "")).status).toBe(403);
    expect(getExpertConfigurationService).not.toHaveBeenCalled();
  });

  it.each(["/settings/43/experts/bug", "/settings/invalid/experts/bug"])(
    "refuse l'accès à %s",
    async (url) => {
      expect((await request(url)).status).toBe(403);
      expect((await request(`${url}/save`, form)).status).toBe(403);
      expect(getExpertConfigurationService).not.toHaveBeenCalled();
    },
  );

  it("refuse les intentions inactives et les fournisseurs hors V1", async () => {
    expect((await request("/settings/42/experts/refactor")).status).toBe(404);
    expect(
      (await request("/settings/42/experts/refactor/save", form)).status,
    ).toBe(404);
    expect(
      (await request(testPath, { ...form, provider: "groq" })).status,
    ).toBe(400);
    expect(
      (await request(`${path}/save`, { ...form, provider: "custom" })).status,
    ).toBe(400);
    expect(llmFetch).not.toHaveBeenCalled();
  });

  it("valide les longueurs et refuse un endpoint personnalisé", async () => {
    expect(
      (await request(testPath, { ...form, model: "m".repeat(161) })).status,
    ).toBe(400);
    expect(
      (await request(testPath, { ...form, baseUrl: "https://other.example" }))
        .status,
    ).toBe(400);
    expect(llmFetch).not.toHaveBeenCalled();
  });

  it("exige une nouvelle clé pour changer de fournisseur", async () => {
    await request(`${path}/save`, form);
    const response = await request(`${path}/save`, {
      ...form,
      provider: "anthropic",
      apiKey: "",
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("nouvelle clé API");
    expect(rows.get(42)?.provider).toBe("openai");
  });

  it("signale une indisponibilité du service sans exposer les erreurs internes", async () => {
    vi.mocked(getExpertConfigurationService).mockImplementation(() => {
      throw new ExpertConfigurationUnavailableError();
    });
    expect((await request(path)).status).toBe(503);
    expect((await request(testPath, form)).status).toBe(503);
    expect((await request(`${path}/save`, form)).status).toBe(503);
    expect(
      (await request(`${path}/delete`, { _csrf: form._csrf })).status,
    ).toBe(503);
  });

  it("ne reflète pas un secret présent dans une exception inattendue", async () => {
    vi.spyOn(service, "test").mockRejectedValue(new Error(form.apiKey));
    const response = await request(testPath, form);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(form.apiKey);
  });
});
