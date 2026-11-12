import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLlmProvider,
  createTextGenerator,
} from "../src/llm/provider-factory.js";
import { EXPERT_PROVIDER_NAMES } from "../src/configuration/expert-definitions.js";
import { BUG_REVIEW_SCHEMA } from "../src/review/bug-review-response.js";
import { LlmProviderRequestError } from "../src/llm/provider-error.js";
import {
  buildClassificationSystemPrompt,
  buildClassificationPrompt,
} from "../src/llm/prompt-builder.js";
import {
  providerResponse,
  reviewContext,
  reviewText,
} from "./fixtures/bug-review.js";

afterEach(() => {
  vi.unstubAllGlobals();
});
const request = {
  system: "Review system JSON",
  prompt: "Review this diff",
  maxOutputTokens: 1000,
  jsonSchema: BUG_REVIEW_SCHEMA,
};

describe.each(EXPERT_PROVIDER_NAMES)("génération %s", (provider) => {
  const configuration = {
    provider,
    apiKey: "fake-key-never-log",
    model: "test-model",
  };
  it("remonte les tokens déclarés, cache et réflexion compris, sans contenu sensible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => providerResponse(provider, reviewText, true)),
    );
    const onUsage = vi.fn();
    await createTextGenerator(configuration, onUsage).generate(request);
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        promptTokens: 120,
        completionTokens: 40,
        totalTokens: 160,
      }),
    );
    const logged = JSON.stringify(onUsage.mock.calls);
    for (const sensitive of [
      configuration.apiKey,
      request.system,
      request.prompt,
      reviewText,
    ]) {
      expect(logged).not.toContain(sensitive);
    }
  });

  it("ne fabrique pas de consommation si le fournisseur ne renvoie pas de métriques", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => providerResponse(provider, reviewText)),
    );
    const onUsage = vi.fn();
    expect(
      await createTextGenerator(configuration, onUsage).generate(request),
    ).toBe(reviewText);
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("remonte la consommation même si le texte de la réponse est vide", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => providerResponse(provider, "", true)),
    );
    const onUsage = vi.fn();
    await expect(
      createTextGenerator(configuration, onUsage).generate(request),
    ).rejects.toThrow("réponse vide");
    expect(onUsage).toHaveBeenCalledOnce();
  });

  it("réutilise le protocole existant avec le modèle, les prompts et la limite demandés", async () => {
    const fetchMock = vi.fn(async () => providerResponse(provider, reviewText));
    vi.stubGlobal("fetch", fetchMock);
    expect(await createTextGenerator(configuration).generate(request)).toBe(
      reviewText,
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (provider === "anthropic") {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(init.headers).toMatchObject({
        "x-api-key": configuration.apiKey,
        "anthropic-version": "2023-06-01",
      });
      expect(body).toMatchObject({
        model: configuration.model,
        system: request.system,
        max_tokens: 1000,
        messages: [{ role: "user", content: request.prompt }],
      });
    } else if (provider === "openai") {
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${configuration.apiKey}`,
      });
      expect(body).toMatchObject({
        model: configuration.model,
        max_completion_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
      });
    } else {
      expect(url).toContain("/models/test-model:generateContent");
      expect(init.headers).toMatchObject({
        "x-goog-api-key": configuration.apiKey,
      });
      expect(body).toMatchObject({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", required: ["summary", "findings"] },
        },
      });
      expect(
        body.generationConfig.responseSchema.properties.findings.items
          .properties.startLine.type,
      ).toBe("INTEGER");
      expect(
        body.generationConfig.responseSchema.properties,
      ).not.toHaveProperty("suggestions");
    }
  });

  it("conserve la classification et son schéma après une génération de revue", async () => {
    const fetchMock = vi.fn(async () =>
      providerResponse(
        provider,
        '{"suggestions":[],"summary":"Classification"}',
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createTextGenerator(configuration).generate(request);
    const context = reviewContext();
    expect(
      await createLlmProvider(configuration).classifyPullRequest(context),
    ).toMatchObject({ suggestions: [], summary: "Classification" });
    const init = (
      fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    )[1];
    const body = JSON.parse(init.body as string);
    if (provider === "gemini") {
      expect(body.generationConfig.responseSchema.required).toEqual([
        "suggestions",
        "summary",
      ]);
      expect(
        body.generationConfig.responseSchema.properties,
      ).not.toHaveProperty("findings");
      expect(body.systemInstruction.parts[0].text).toBe(
        buildClassificationSystemPrompt(),
      );
      expect(body.contents[0].parts[0].text).toBe(
        buildClassificationPrompt(context),
      );
    } else {
      expect(
        provider === "anthropic" ? body.system : body.messages[0].content,
      ).toBe(buildClassificationSystemPrompt());
      expect(body.messages.at(-1).content).toBe(
        buildClassificationPrompt(context),
      );
    }
  });

  it("rejette une réponse vide", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => providerResponse(provider, "  ")),
    );
    await expect(
      createTextGenerator(configuration).generate(request),
    ).rejects.toThrow("réponse vide");
  });

  it("ne propage pas la clé réfléchie par une erreur HTTP et préserve Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: configuration.apiKey } },
          { status: 429, headers: { "retry-after": "2" } },
        ),
      ),
    );
    const error = await createTextGenerator(configuration)
      .generate(request)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(LlmProviderRequestError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 2000 });
    expect(inspect(error)).not.toContain(configuration.apiKey);
  });

  it("préserve le type de panne réseau sans divulguer ses détails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new DOMException(configuration.apiKey, "TimeoutError"),
        ),
    );
    const error = await createTextGenerator(configuration)
      .generate(request)
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({ name: "TimeoutError" });
    expect(inspect(error)).not.toContain(configuration.apiKey);
  });
});

it("refuse les fournisseurs non activés et les limites de sortie invalides", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(() =>
    createTextGenerator({
      provider: "groq",
      apiKey: "fake-key",
      model: "test",
    }),
  ).toThrow("ne prend pas en charge");
  await expect(
    createTextGenerator({
      provider: "openai",
      apiKey: "fake-key",
      model: "test",
    }).generate({ ...request, maxOutputTokens: 0 }),
  ).rejects.toThrow("entier positif");
  expect(fetchMock).not.toHaveBeenCalled();
});
