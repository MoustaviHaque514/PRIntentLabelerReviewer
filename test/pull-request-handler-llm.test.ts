import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePullRequestEvent } from "../src/handlers/pull-request-handler.js";
import type { LlmProvider } from "../src/llm/llm-provider.js";
import { toAiLabelName } from "../src/labels/ai-label-name.js";
import type { BugReviewExpert } from "../src/review/bug-review-expert.js";
import { getExpertConfigurationService } from "../src/configuration/expert-configuration-runtime.js";
import { EXPERT_PROVIDER_NAMES } from "../src/configuration/expert-definitions.js";
import {
  finding,
  providerResponse,
  reviewText,
} from "./fixtures/bug-review.js";

vi.mock("../src/configuration/expert-configuration-runtime.js", () => ({
  getExpertConfigurationService: vi.fn(),
}));
const resolveConfiguration = vi.fn();

function createMockContext() {
  return {
    payload: {
      action: "opened",
      installation: { id: 42 },
      pull_request: {
        number: 7,
        title: "Add JWT auth",
        body: "",
        user: { login: "talip" },
        base: { ref: "main" },
        head: { ref: "feat/jwt", sha: "sha-jwt" },
        html_url: "",
        additions: 30,
        deletions: 2,
        changed_files: 1,
      },
      repository: { owner: { login: "org" }, name: "repo" },
    },
    octokit: {
      pulls: {
        listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
        createReview: vi.fn().mockResolvedValue({}),
        listFiles: vi.fn().mockResolvedValue({
          data: [
            {
              filename: "src/auth/jwt.ts",
              status: "added",
              additions: 30,
              deletions: 0,
              changes: 30,
            },
          ],
        }),
      },
      issues: {
        listLabelsForRepo: vi
          .fn()
          .mockResolvedValue({ data: [{ name: "feature" }, { name: "bug" }] }),
        listLabelsOnIssue: vi.fn().mockResolvedValue({ data: [] }),
        listComments: vi.fn().mockResolvedValue({ data: [] }),
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        getLabel: vi.fn().mockResolvedValue({ data: { color: "d73a4a" } }),
      },
      checks: {
        create: vi.fn().mockResolvedValue({}),
      },
    },
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
}

function mockProvider(): LlmProvider {
  return {
    classifyPullRequest: vi.fn().mockResolvedValue({
      suggestions: [
        { name: "feature", confidence: 0.95, reason: "nouvel endpoint" },
        { name: "bug", confidence: 0.72, reason: "corrige un cas limite" },
      ],
      summary: "Ajoute l'authentification JWT.",
    }),
  };
}

describe("handlePullRequestEvent — chemin LLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConfiguration.mockReset().mockResolvedValue(null);
    vi.mocked(getExpertConfigurationService)
      .mockReset()
      .mockReturnValue({
        resolve: resolveConfiguration,
      } as unknown as ReturnType<typeof getExpertConfigurationService>);
    vi.stubEnv("GEMINI_REVIEW_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    delete process.env.LABEL_MODE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.LABEL_MODE;
  });

  it("mode suggest : commente sans appliquer de label", async () => {
    process.env.LABEL_MODE = "suggest";
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, mockProvider());

    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });

  it("mode auto-high : applique les labels au-dessus du seuil et retire les autres suggérés", async () => {
    process.env.LABEL_MODE = "auto-high";
    const ctx = createMockContext();
    ctx.octokit.issues.listLabelsOnIssue = vi
      .fn()
      .mockResolvedValue({ data: [{ name: toAiLabelName("bug") }] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, mockProvider());

    expect(ctx.octokit.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: toAiLabelName("bug") }),
    );
    expect(ctx.octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: [toAiLabelName("feature")] }),
    );
  });

  it("mode auto-all : applique tous les labels retenus, préfixés par l'icône IA", async () => {
    process.env.LABEL_MODE = "auto-all";
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, mockProvider());

    expect(ctx.octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: [toAiLabelName("feature"), toAiLabelName("bug")],
      }),
    );
  });

  it("mode suggest : ne crée ni n'applique aucun label", async () => {
    process.env.LABEL_MODE = "suggest";
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, mockProvider());

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.createLabel).not.toHaveBeenCalled();
  });

  it("ne plante pas si l'application des labels échoue", async () => {
    process.env.LABEL_MODE = "auto-all";
    const ctx = createMockContext();
    ctx.octokit.issues.addLabels = vi
      .fn()
      .mockRejectedValue(new Error("403 Forbidden"));

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handlePullRequestEvent(ctx as any, mockProvider()),
    ).resolves.not.toThrow();

    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
  });

  it("rejette un label existant dans le dépôt mais absent du catalogue envoyé au LLM", async () => {
    process.env.LABEL_MODE = "auto-all";
    const ctx = createMockContext();
    ctx.octokit.issues.listLabelsForRepo = vi.fn().mockResolvedValue({
      data: Array.from({ length: 31 }, (_, index) => ({
        name: `custom-label-${index + 1}`,
      })),
    });
    const provider: LlmProvider = {
      classifyPullRequest: vi.fn().mockResolvedValue({
        suggestions: [
          {
            name: "custom-label-31",
            confidence: 0.99,
            reason: "Not shown to the model",
          },
        ],
        summary: "Summary.",
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, provider);

    expect(provider.classifyPullRequest).toHaveBeenCalled();
    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });

  it("n'appelle pas le LLM lorsqu'aucun label candidat n'est disponible", async () => {
    const ctx = createMockContext();
    ctx.octokit.issues.listLabelsForRepo = vi
      .fn()
      .mockResolvedValue({ data: [] });
    const provider = mockProvider();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, provider);

    expect(provider.classifyPullRequest).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
  });

  it("achemine une PR classée bug vers l'expert spécialisé", async () => {
    const ctx = createMockContext();
    const expert: BugReviewExpert = {
      reviewBugFix: vi.fn().mockResolvedValue({
        verdict: "approved",
        summary: "La correction est valide.",
        findings: [],
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, mockProvider(), expert);

    expect(expert.reviewBugFix).toHaveBeenCalledOnce();
    expect(resolveConfiguration).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Verdict : correction validée"),
      }),
    );
  });

  it("n'appelle pas l'expert bug quand le classifieur retient seulement feature", async () => {
    const ctx = createMockContext();
    const classifier: LlmProvider = {
      classifyPullRequest: vi.fn().mockResolvedValue({
        suggestions: [
          { name: "feature", confidence: 0.95, reason: "nouvel endpoint" },
        ],
        summary: "Ajoute un endpoint.",
      }),
    };
    const expert: BugReviewExpert = {
      reviewBugFix: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, classifier, expert);

    expect(expert.reviewBugFix).not.toHaveBeenCalled();
    expect(resolveConfiguration).not.toHaveBeenCalled();
  });

  it.each(EXPERT_PROVIDER_NAMES)(
    "appelle réellement l'adaptateur %s configuré puis publie les constats validés",
    async (provider) => {
      const ctx = createMockContext();
      ctx.octokit.pulls.listFiles.mockResolvedValue({
        data: [
          {
            filename: finding.file,
            status: "modified",
            additions: 1,
            deletions: 1,
            changes: 2,
            patch: "@@ -1,2 +1,2 @@\n-old\n+new\n context",
          },
        ],
      });
      const configuration = {
        installationId: 42,
        intention: "bug",
        provider,
        model: "selected-model",
        apiKey: "fake-selected-key",
      };
      resolveConfiguration.mockResolvedValue(configuration);
      vi.stubEnv("GEMINI_REVIEW_API_KEY", "fake-fallback-must-not-be-used");
      const fetchMock = vi.fn(async () =>
        providerResponse(provider, reviewText, true),
      );
      vi.stubGlobal("fetch", fetchMock);
      await handlePullRequestEvent(
        ctx as unknown as Parameters<typeof handlePullRequestEvent>[0],
        mockProvider(),
      );
      expect(resolveConfiguration).toHaveBeenCalledWith(42, "bug");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      const body = JSON.parse(init.body as string);
      if (provider === "gemini")
        expect(url).toContain("models/selected-model:generateContent");
      else expect(body.model).toBe("selected-model");
      expect(JSON.stringify(init.headers)).toContain(configuration.apiKey);
      expect(JSON.stringify(init.headers)).not.toContain("fake-fallback");
      expect(ctx.octokit.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({
          commit_id: "sha-jwt",
          event: "REQUEST_CHANGES",
          comments: [
            expect.objectContaining({
              path: finding.file,
              line: 1,
              side: "RIGHT",
            }),
          ],
        }),
      );
      expect(ctx.log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          installationId: 42,
          intention: "bug",
          provider,
          model: "selected-model",
          source: "installation",
        }),
        "Bug review configuration selected",
      );
      expect(JSON.stringify(ctx.log.info.mock.calls)).not.toContain(
        configuration.apiKey,
      );
      expect(ctx.log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          installationId: 42,
          intention: "bug",
          pullNumber: ctx.payload.pull_request.number,
          model: "selected-model",
          promptTokens: 120,
          completionTokens: 40,
          totalTokens: 160,
        }),
        "Expert token usage measured",
      );
      expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
      expect(ctx.octokit.checks.create).toHaveBeenCalled();
    },
  );

  it("applique une modification au prochain événement sans changer l'analyse déjà lancée", async () => {
    const ctx = createMockContext();
    const configuration = {
      installationId: 42,
      intention: "bug",
      provider: "openai",
      model: "first-model",
      apiKey: "fake-key",
    };
    resolveConfiguration.mockResolvedValue(configuration);
    let complete!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      )
      .mockImplementation(async () =>
        providerResponse("openai", '{"summary":"OK","findings":[]}'),
      );
    vi.stubGlobal("fetch", fetchMock);
    const first = handlePullRequestEvent(
      ctx as unknown as Parameters<typeof handlePullRequestEvent>[0],
      mockProvider(),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveConfiguration.mockResolvedValue({
      ...configuration,
      model: "second-model",
    });
    complete(providerResponse("openai", '{"summary":"OK","findings":[]}'));
    await first;
    ctx.payload.pull_request.head.sha = "next-sha";
    await handlePullRequestEvent(
      ctx as unknown as Parameters<typeof handlePullRequestEvent>[0],
      mockProvider(),
    );
    expect(
      fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).model),
    ).toEqual(["first-model", "second-model"]);
    expect(resolveConfiguration).toHaveBeenCalledTimes(2);
  });

  it("continue classification, commentaire et check run après un échec de résolution", async () => {
    const ctx = createMockContext();
    resolveConfiguration.mockRejectedValue(
      new Error("fake-sensitive-storage-error"),
    );
    vi.stubEnv("GEMINI_REVIEW_API_KEY", "fake-fallback-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await handlePullRequestEvent(
      ctx as unknown as Parameters<typeof handlePullRequestEvent>[0],
      mockProvider(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.octokit.pulls.createReview).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Impossible de charger"),
      }),
    );
    expect(ctx.octokit.checks.create).toHaveBeenCalled();
    expect(JSON.stringify(ctx.log.warn.mock.calls)).not.toContain(
      "fake-sensitive",
    );
    expect(ctx.log.error).not.toHaveBeenCalled();
  });

  it("ne bascule pas sur Gemini après le refus du fournisseur enregistré", async () => {
    const ctx = createMockContext();
    resolveConfiguration.mockResolvedValue({
      installationId: 42,
      intention: "bug",
      provider: "anthropic",
      model: "selected",
      apiKey: "fake-rejected-key",
    });
    vi.stubEnv("GEMINI_REVIEW_API_KEY", "fake-fallback-key");
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { message: "fake-rejected-key" } },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await handlePullRequestEvent(
      ctx as unknown as Parameters<typeof handlePullRequestEvent>[0],
      mockProvider(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ctx.octokit.pulls.createReview).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
    expect(ctx.octokit.checks.create).toHaveBeenCalled();
    expect(JSON.stringify(ctx.log.warn.mock.calls)).not.toContain(
      "fake-rejected-key",
    );
    expect(
      JSON.stringify(ctx.octokit.issues.createComment.mock.calls),
    ).not.toContain("fake-rejected-key");
  });

  it("ne lit aucune configuration d'expert quand la classification ne retient pas bug", async () => {
    const ctx = createMockContext();
    const classifier: LlmProvider = {
      classifyPullRequest: vi.fn().mockResolvedValue({
        suggestions: [{ name: "feature", confidence: 0.95, reason: "Ajout" }],
        summary: "Ajout",
      }),
    };
    await handlePullRequestEvent(
      ctx as unknown as Parameters<typeof handlePullRequestEvent>[0],
      classifier,
    );
    expect(getExpertConfigurationService).not.toHaveBeenCalled();
    expect(ctx.octokit.pulls.createReview).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
  });

  it("préserve l'injection null pour désactiver la revue dans les tests", async () => {
    const ctx = createMockContext();
    await handlePullRequestEvent(
      ctx as unknown as Parameters<typeof handlePullRequestEvent>[0],
      mockProvider(),
      null,
    );
    expect(getExpertConfigurationService).not.toHaveBeenCalled();
    expect(ctx.octokit.pulls.createReview).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
  });
});
