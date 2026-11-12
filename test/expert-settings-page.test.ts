import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { renderExpertSettingsPage } from "../src/http/expert-settings-page.js";
import { renderSettingsPage } from "../src/http/settings-page.js";
import { renderSettingsClientScript } from "../src/http/llm-settings-form.js";
import { LLM_PROVIDER_DEFINITIONS } from "../src/llm/provider-configuration.js";
import type { ExpertConfigurationSummary } from "../src/configuration/expert-configuration.js";

const session = {
  githubUserId: 7,
  githubLogin: "<user>",
  installationIds: [42],
  csrfToken: "csrf-token",
  expiresAt: new Date(),
};
const configuration: ExpertConfigurationSummary = {
  installationId: 42,
  intention: "bug",
  provider: "anthropic",
  model: '<model "test">',
  keyLastFour: "1234",
  updatedAt: new Date(),
  updatedByGithubUserId: 7,
};

describe("pages de configuration", () => {
  it("rend l'accès à Bug visible depuis les paramètres sans changer les routes du classifieur", () => {
    const html = renderSettingsPage({
      installationId: 42,
      session,
      configuration: null,
    });
    expect(html).toContain('href="/settings/42/experts/bug"');
    expect(html).toContain('action="/settings/42/save"');
    expect(html).toContain('data-test-url="/api/installations/42/llm/test"');
    expect(html).toContain('value="groq"');
    expect(html).toContain('name="baseUrl"');
    expect(html).not.toContain("/experts/refactor");
  });

  it("affiche les trois fournisseurs, les actions dédiées et l'application aux prochaines PR", () => {
    const html = renderExpertSettingsPage({
      installationId: 42,
      intention: "bug",
      session,
      configuration,
    });
    for (const provider of ["anthropic", "openai", "gemini"])
      expect(html).toContain(`value="${provider}"`);
    for (const provider of ["groq", "custom", "xai", "perplexity"])
      expect(html).not.toContain(`value="${provider}"`);
    expect(html).not.toContain('name="baseUrl"');
    expect(html).toContain('action="/settings/42/experts/bug/save"');
    expect(html).toContain('action="/settings/42/experts/bug/delete"');
    expect(html).toContain(
      'data-test-url="/api/installations/42/experts/bug/llm/test"',
    );
    expect(html).toContain("utilisée à la prochaine analyse");
    expect(html).toContain("Après suppression");
    expect(html).not.toContain("activation à venir");
    expect(html).toContain("&lt;user&gt;");
    expect(html).toContain("&lt;model &quot;test&quot;&gt;");
    expect(html).toContain("terminant par <code>1234</code>");
    expect(html).toMatch(/name="apiKey"[^>]*type="password"[^>]*>/);
    expect(html.match(/<input[^>]*name="apiKey"[^>]*>/)?.[0]).not.toContain(
      "value=",
    );
    expect(html).toContain('name="_csrf" value="csrf-token"');
  });

  it("permet de créer une configuration et échappe les messages d'erreur", () => {
    const html = renderExpertSettingsPage({
      installationId: 42,
      intention: "bug",
      session,
      configuration: null,
      error: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("/bug/delete");
    expect(html).toContain("Aucune configuration enregistrée");
    expect(html.match(/<input[^>]*name="apiKey"[^>]*>/)?.[0]).toContain(
      "required",
    );
    expect(html).toContain("&lt;script&gt;");
  });
});

function clientFixture() {
  const listeners: Record<string, () => void | Promise<void>> = {};
  const provider = {
    value: "gemini",
    addEventListener: (_: string, fn: () => void) => {
      listeners.change = fn;
    },
  };
  const model = { value: LLM_PROVIDER_DEFINITIONS.gemini.defaultModel };
  const form = {
    dataset: {
      storedProvider: "gemini",
      testUrl: "/api/installations/42/experts/bug/llm/test",
    },
    reportValidity: vi.fn(() => true),
  };
  const key = { required: false };
  const suggestions = { replaceChildren: vi.fn() };
  const result = { className: "", textContent: "" };
  const button = {
    disabled: false,
    addEventListener: (_: string, fn: () => Promise<void>) => {
      listeners.test = fn;
    },
  };
  const elements: Record<string, unknown> = {
    "llm-settings-form": form,
    provider,
    model,
    apiKey: key,
    "known-models": suggestions,
    "connection-result": result,
    "test-connection": button,
  };
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ message: "Connexion réussie" }),
  }));
  class FormData {
    *[Symbol.iterator]() {
      yield ["_csrf", "csrf-token"];
      yield ["provider", provider.value];
    }
  }
  runInNewContext(renderSettingsClientScript(), {
    document: {
      getElementById: (id: string) => elements[id] ?? null,
      createElement: () => ({ value: "" }),
    },
    fetch,
    FormData,
    URLSearchParams,
  });
  return {
    listeners,
    provider,
    model,
    form,
    key,
    suggestions,
    result,
    button,
    fetch,
  };
}

describe("script partagé de configuration", () => {
  it("actualise les suggestions et exige une nouvelle clé quand le fournisseur change", async () => {
    const ui = clientFixture();
    ui.provider.value = "anthropic";
    await ui.listeners.change();
    expect(ui.model.value).toBe(
      LLM_PROVIDER_DEFINITIONS.anthropic.defaultModel,
    );
    expect(ui.key.required).toBe(true);
    expect(
      ui.suggestions.replaceChildren.mock.calls
        .at(-1)
        ?.map((option) => option.value),
    ).toEqual(LLM_PROVIDER_DEFINITIONS.anthropic.suggestedModels);
    ui.model.value = "custom-model-id";
    ui.provider.value = "gemini";
    await ui.listeners.change();
    expect(ui.model.value).toBe("custom-model-id");
    expect(ui.key.required).toBe(false);
  });

  it("envoie le test à l'URL dédiée sans enregistrer et réactive le bouton", async () => {
    const ui = clientFixture();
    await ui.listeners.test();
    expect(ui.fetch).toHaveBeenCalledWith(
      ui.form.dataset.testUrl,
      expect.objectContaining({ method: "POST" }),
    );
    const init = (
      ui.fetch.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(String(init.body)).toContain("_csrf=csrf-token");
    expect(ui.result.textContent).toBe("Connexion réussie");
    expect(ui.button.disabled).toBe(false);
  });

  it("n'envoie pas un formulaire invalide et affiche les erreurs réseau sans HTML", async () => {
    const ui = clientFixture();
    ui.form.reportValidity.mockReturnValue(false);
    await ui.listeners.test();
    expect(ui.fetch).not.toHaveBeenCalled();
    ui.form.reportValidity.mockReturnValue(true);
    ui.fetch.mockRejectedValue(new Error("network"));
    await ui.listeners.test();
    expect(ui.result.textContent).toContain("inaccessible");
    expect(ui.button.disabled).toBe(false);
  });
});
