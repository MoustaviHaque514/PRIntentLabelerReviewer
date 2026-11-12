import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurableBugReviewExpert } from "../src/review/configurable-bug-review-expert.js";
import { createBugReviewExpert } from "../src/review/bug-review-expert-factory.js";
import { defaultLlmTokenBudget } from "../src/llm/model-budget.js";
import { EXPERT_PROVIDER_NAMES } from "../src/configuration/expert-definitions.js";
import {
  buildBugReviewSystemPrompt,
  buildBugReviewPrompt,
} from "../src/review/bug-review-prompt.js";
import { LlmProviderRequestError } from "../src/llm/provider-error.js";
import {
  finding,
  providerResponse,
  reviewContext,
  reviewText,
} from "./fixtures/bug-review.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup(text = reviewText) {
  const generator = {
    tokenBudget: defaultLlmTokenBudget(),
    generate: vi.fn().mockResolvedValue(text),
  };
  return { generator, expert: new ConfigurableBugReviewExpert(generator) };
}

describe("expert bug configurable", () => {
  it.each(EXPERT_PROVIDER_NAMES)(
    "compte une seule fois la réponse %s après un retry HTTP",
    async (provider) => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            { error: { message: "busy" } },
            { status: 429, headers: { "retry-after": "0" } },
          ),
        )
        .mockImplementation(async () =>
          providerResponse(provider, reviewText, true),
        );
      vi.stubGlobal("fetch", fetchMock);
      const onUsage = vi.fn();
      const expert = createBugReviewExpert(
        {
          installationId: 42,
          intention: "bug",
          provider,
          model: "test-model",
          apiKey: "fake-key",
        },
        onUsage,
      );
      const result = expert.reviewBugFix(reviewContext());
      await vi.runAllTimersAsync();
      expect((await result).findings).toEqual([finding]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onUsage).toHaveBeenCalledOnce();
      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({ totalTokens: 160 }),
      );
    },
  );

  it.each(EXPERT_PROVIDER_NAMES)(
    "conserve la consommation %s quand le parseur refuse la revue",
    async (provider) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => providerResponse(provider, "invalid JSON", true)),
      );
      const onUsage = vi.fn();
      const expert = createBugReviewExpert(
        {
          installationId: 42,
          intention: "bug",
          provider,
          model: "test-model",
          apiKey: "fake-key",
        },
        onUsage,
      );
      await expect(expert.reviewBugFix(reviewContext())).rejects.toThrow();
      expect(onUsage).toHaveBeenCalledOnce();
    },
  );
  it.each(EXPERT_PROVIDER_NAMES)(
    "produit les mêmes constats validés avec %s",
    async (provider) => {
      const fetchMock = vi.fn(async () =>
        providerResponse(provider, reviewText),
      );
      vi.stubGlobal("fetch", fetchMock);
      const expert = createBugReviewExpert({
        installationId: 42,
        intention: "bug",
        provider,
        model: "test-model",
        apiKey: "fake-key",
      });
      const context = reviewContext();
      const before = structuredClone(context);
      expect(await expert.reviewBugFix(context)).toEqual({
        verdict: "changes-requested",
        summary: "Une correction est nécessaire.",
        findings: [finding],
      });
      expect(context).toEqual(before);
      const init = (
        fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      )[1];
      const body = JSON.parse(init.body as string);
      let system: string;
      let prompt: string;
      if (provider === "gemini") {
        system = body.systemInstruction.parts[0].text;
        prompt = body.contents[0].parts[0].text;
      } else if (provider === "anthropic") {
        system = body.system;
        prompt = body.messages.at(-1).content;
      } else {
        system = body.messages[0].content;
        prompt = body.messages.at(-1).content;
      }
      expect(system).toBe(buildBugReviewSystemPrompt());
      expect(prompt).toBe(buildBugReviewPrompt(context));
    },
  );

  it("conserve le filtrage des fichiers et lignes inventés", async () => {
    const { expert } = setup(
      JSON.stringify({
        summary: "Constats",
        findings: [
          finding,
          { ...finding, file: "missing.ts" },
          { ...finding, startLine: 999, endLine: 999 },
        ],
      }),
    );
    expect((await expert.reviewBugFix(reviewContext())).findings).toEqual([
      finding,
    ]);
  });

  it("accepte une revue vide et les blocs JSON tolérés par le parseur", async () => {
    const { expert } = setup(
      '```json\n{"summary":"Aucun défaut vérifiable.","findings":[]}\n```',
    );
    expect(await expert.reviewBugFix(reviewContext())).toMatchObject({
      verdict: "approved",
      findings: [],
    });
  });

  it.each([
    "",
    "not json",
    '{"summary":"Classification","suggestions":[]}',
    '{"summary":"", "findings":[]}',
    '{"summary":"Revue","findings":null}',
  ])("refuse une réponse non conforme : %s", async (text) => {
    const { expert, generator } = setup(text);
    await expect(expert.reviewBugFix(reviewContext())).rejects.toThrow();
    expect(generator.generate).toHaveBeenCalledTimes(1);
  });

  it("rejette un contexte trop grand avant l'appel sans le tronquer", async () => {
    const { expert, generator } = setup();
    generator.tokenBudget.promptTokenBudget = 1;
    const context = reviewContext();
    const before = structuredClone(context);
    await expect(expert.reviewBugFix(context)).rejects.toThrow(
      "dépasse le budget",
    );
    expect(generator.generate).not.toHaveBeenCalled();
    expect(context).toEqual(before);
  });

  it("réessaie une erreur transitoire sans multiplier les politiques de retry", async () => {
    vi.useFakeTimers();
    const { expert, generator } = setup();
    generator.generate.mockRejectedValueOnce(
      new LlmProviderRequestError("Test", 429, undefined, 1),
    );
    const result = expert.reviewBugFix(reviewContext());
    await vi.runAllTimersAsync();
    expect((await result).findings).toEqual([finding]);
    expect(generator.generate).toHaveBeenCalledTimes(2);
  });

  it("ne réessaie pas une clé refusée", async () => {
    const { expert, generator } = setup();
    generator.generate.mockRejectedValue(
      new LlmProviderRequestError("Test", 401),
    );
    await expect(expert.reviewBugFix(reviewContext())).rejects.toThrow("401");
    expect(generator.generate).toHaveBeenCalledTimes(1);
  });
});
