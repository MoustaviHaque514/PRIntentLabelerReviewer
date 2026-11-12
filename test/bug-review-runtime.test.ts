import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveBugReviewExpert,
  BugReviewConfigurationError,
} from "../src/review/runtime.js";
import { getExpertConfigurationService } from "../src/configuration/expert-configuration-runtime.js";
import { createBugReviewExpert } from "../src/review/bug-review-expert-factory.js";
import { EXPERT_PROVIDER_NAMES } from "../src/configuration/expert-definitions.js";
import {
  providerResponse,
  reviewContext,
  reviewText,
} from "./fixtures/bug-review.js";

vi.mock("../src/configuration/expert-configuration-runtime.js", () => ({
  getExpertConfigurationService: vi.fn(),
}));
vi.mock("../src/review/bug-review-expert-factory.js", () => ({
  createBugReviewExpert: vi.fn(),
}));
const resolve = vi.fn();
const expert = { reviewBugFix: vi.fn() };

beforeEach(() => {
  vi.stubEnv("GEMINI_REVIEW_API_KEY", "fake-fallback-key");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GEMINI_REVIEW_MODEL", "fallback-model");
  resolve.mockReset().mockResolvedValue(null);
  vi.mocked(getExpertConfigurationService)
    .mockReset()
    .mockReturnValue({ resolve } as unknown as ReturnType<
      typeof getExpertConfigurationService
    >);
  vi.mocked(createBugReviewExpert).mockReset().mockReturnValue(expert);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("résolution de l'expert Bug", () => {
  it("remonte aussi les tokens de l'expert Gemini de repli", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => providerResponse("gemini", reviewText, true)),
    );
    const onUsage = vi.fn();
    const selected = await resolveBugReviewExpert(42, onUsage);
    await selected!.expert.reviewBugFix(reviewContext());
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "Gemini",
        model: "fallback-model",
        totalTokens: 160,
      }),
    );
  });
  it.each(EXPERT_PROVIDER_NAMES)(
    "priorise la configuration %s de l'installation",
    async (provider) => {
      const configuration = {
        installationId: 42,
        intention: "bug",
        provider,
        model: "selected-model",
        apiKey: "fake-private-key",
      };
      resolve.mockResolvedValue(configuration);
      const onUsage = vi.fn();
      const selected = await resolveBugReviewExpert(42, onUsage);
      expect(resolve).toHaveBeenCalledWith(42, "bug");
      expect(createBugReviewExpert).toHaveBeenCalledWith(
        configuration,
        onUsage,
      );
      expect(selected).toEqual({
        expert,
        metadata: {
          installationId: 42,
          intention: "bug",
          provider,
          model: "selected-model",
          source: "installation",
        },
      });
      expect(JSON.stringify(selected?.metadata)).not.toContain(
        configuration.apiKey,
      );
    },
  );

  it("relit à chaque analyse et isole les installations", async () => {
    resolve.mockImplementation(async (installationId: number) => ({
      installationId,
      intention: "bug",
      provider: "openai",
      model: `model-${installationId}`,
      apiKey: "fake-key",
    }));
    expect((await resolveBugReviewExpert(42))?.metadata.model).toBe("model-42");
    expect((await resolveBugReviewExpert(43))?.metadata.model).toBe("model-43");
    resolve.mockResolvedValue({
      installationId: 42,
      intention: "bug",
      provider: "anthropic",
      model: "new-model",
      apiKey: "fake-new-key",
    });
    expect((await resolveBugReviewExpert(42))?.metadata.model).toBe(
      "new-model",
    );
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it("utilise le repli Gemini seulement après une lecture sans configuration", async () => {
    const selected = await resolveBugReviewExpert(42);
    expect(selected?.metadata).toEqual({
      installationId: 42,
      intention: "bug",
      provider: "gemini",
      model: "fallback-model",
      source: "environment",
    });
    expect(selected?.expert.reviewBugFix).toBeTypeOf("function");
    expect(createBugReviewExpert).not.toHaveBeenCalled();
  });

  it("retourne null si aucune configuration ni clé serveur n'est disponible", async () => {
    vi.stubEnv("GEMINI_REVIEW_API_KEY", "");
    expect(await resolveBugReviewExpert(42)).toBeNull();
  });

  it("conserve le repli GEMINI_API_KEY si la clé de revue est absente", async () => {
    vi.stubEnv("GEMINI_REVIEW_API_KEY", undefined);
    vi.stubEnv("GEMINI_API_KEY", "fake-general-key");
    expect((await resolveBugReviewExpert(42))?.metadata.source).toBe(
      "environment",
    );
  });

  it("refuse tout repli après une erreur de lecture ou de construction", async () => {
    resolve.mockRejectedValueOnce(new Error("fake-secret-in-db-error"));
    await expect(resolveBugReviewExpert(42)).rejects.toThrow(
      BugReviewConfigurationError,
    );
    expect(createBugReviewExpert).not.toHaveBeenCalled();
    resolve.mockResolvedValue({
      installationId: 42,
      intention: "bug",
      provider: "openai",
      model: "model",
      apiKey: "fake-key",
    });
    vi.mocked(createBugReviewExpert).mockImplementation(() => {
      throw new Error("fake-secret-in-constructor");
    });
    const error = await resolveBugReviewExpert(42).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(BugReviewConfigurationError);
    expect(String(error)).not.toContain("fake-secret");
    expect(error).not.toHaveProperty("cause");
  });

  it("signale un service indisponible sans revenir à Gemini", async () => {
    vi.mocked(getExpertConfigurationService).mockImplementation(() => {
      throw new Error("unavailable");
    });
    await expect(resolveBugReviewExpert(42)).rejects.toThrow(
      BugReviewConfigurationError,
    );
  });

  it.each([undefined, 0, -1, Number.MAX_SAFE_INTEGER + 1])(
    "refuse une installation invalide %s",
    async (id) => {
      await expect(resolveBugReviewExpert(id)).rejects.toThrow(
        BugReviewConfigurationError,
      );
      expect(getExpertConfigurationService).not.toHaveBeenCalled();
    },
  );
});
