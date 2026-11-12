import { LlmProviderRequestError } from "../llm/provider-error.js";
import type { ApiKeyCipher } from "../security/api-key-cipher.js";
import type {
  ChangeExpertConfigurationInput,
  ExpertConfigurationReader,
  ExpertConfigurationSummary,
  ResolvedExpertConfiguration,
  TestExpertConfigurationInput,
} from "./expert-configuration.js";
import {
  assertExpertIntention,
  assertExpertProvider,
  type ExpertIntention,
} from "./expert-definitions.js";
import type { LlmConfigurationRepository } from "./llm-configuration-repository.js";
import { LlmConfigurationService } from "./llm-configuration-service.js";

// Seuls les messages internes connus peuvent franchir la frontière du service.
// Un fournisseur peut reproduire une clé dans son erreur ; ne jamais propager
// son message brut, sa cause ou un objet de requête à un futur appelant HTTP.
const SAFE_VALIDATION_MESSAGES = new Set([
  "La clé API est requise.",
  "Une nouvelle clé API est requise lors du changement de fournisseur.",
  "Le modèle LLM est requis.",
]);

async function withSafeConfigurationErrors<T>(
  operation: () => Promise<T>,
  failureMessage: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LlmProviderRequestError) {
      throw new LlmProviderRequestError(
        "Le fournisseur de l’expert",
        error.status,
        undefined,
        error.retryAfterMs,
      );
    }
    if (error instanceof Error && SAFE_VALIDATION_MESSAGES.has(error.message)) {
      throw new Error(error.message);
    }
    throw new Error(failureMessage);
  }
}

function assertPositiveId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("L’identifiant GitHub doit être un entier positif sûr.");
  }
}

function validateInput(input: TestExpertConfigurationInput): void {
  assertExpertIntention(input.intention);
  assertExpertProvider(input.intention, input.provider);
  assertPositiveId(input.installationId);
  if (typeof input.model !== "string" || input.model.trim().length > 160) {
    throw new Error("Le nom du modèle est invalide ou trop long.");
  }
  if (
    input.apiKey !== undefined &&
    (typeof input.apiKey !== "string" || input.apiKey.trim().length > 4096)
  ) {
    throw new Error("La clé API est invalide ou trop longue.");
  }
  if (input.baseUrl !== undefined && input.baseUrl !== "") {
    throw new Error(
      "Une URL personnalisée n’est pas autorisée pour cet expert.",
    );
  }
}

export class ExpertConfigurationService implements ExpertConfigurationReader {
  private readonly services = new Map<
    ExpertIntention,
    LlmConfigurationService
  >();

  constructor(
    private readonly repositoryForIntention: (
      intention: ExpertIntention,
    ) => LlmConfigurationRepository,
    private readonly cipher: ApiKeyCipher,
    private readonly removeInstallation?: (
      installationId: number,
      githubUserId?: number,
    ) => Promise<number>,
  ) {}

  async getSummary(
    installationId: number,
    intention: ExpertIntention,
  ): Promise<ExpertConfigurationSummary | null> {
    this.validateScope(installationId, intention);
    return withSafeConfigurationErrors(async () => {
      const summary =
        await this.serviceFor(intention).getSummary(installationId);
      if (!summary) {
        return null;
      }
      const provider = summary.provider;
      assertExpertProvider(intention, provider);
      return { ...summary, intention, provider };
    }, "Impossible de lire la configuration de cet expert.");
  }

  async resolve(
    installationId: number,
    intention: ExpertIntention,
  ): Promise<ResolvedExpertConfiguration | null> {
    this.validateScope(installationId, intention);
    return withSafeConfigurationErrors(async () => {
      const configuration =
        await this.serviceFor(intention).resolve(installationId);
      if (!configuration) {
        return null;
      }
      const provider = configuration.provider;
      assertExpertProvider(intention, provider);
      return { ...configuration, intention, provider };
    }, "Impossible de résoudre la configuration de cet expert.");
  }

  async test(input: TestExpertConfigurationInput): Promise<void> {
    validateInput(input);
    await withSafeConfigurationErrors(
      () => this.serviceFor(input.intention).test(input),
      "Impossible de tester la configuration de cet expert.",
    );
  }

  async save(
    input: ChangeExpertConfigurationInput,
  ): Promise<ExpertConfigurationSummary> {
    validateInput(input);
    assertPositiveId(input.githubUserId);
    return withSafeConfigurationErrors(async () => {
      const summary = await this.serviceFor(input.intention).save(input);
      const provider = summary.provider;
      assertExpertProvider(input.intention, provider);
      return { ...summary, intention: input.intention, provider };
    }, "Impossible d’enregistrer la configuration de cet expert.");
  }

  async delete(
    installationId: number,
    intention: ExpertIntention,
    githubUserId?: number,
  ): Promise<boolean> {
    this.validateScope(installationId, intention);
    if (githubUserId !== undefined) {
      assertPositiveId(githubUserId);
    }
    return withSafeConfigurationErrors(
      () => this.serviceFor(intention).delete(installationId, githubUserId),
      "Impossible de supprimer la configuration de cet expert.",
    );
  }

  async deleteForInstallation(
    installationId: number,
    githubUserId?: number,
  ): Promise<number> {
    assertPositiveId(installationId);
    if (githubUserId !== undefined) {
      assertPositiveId(githubUserId);
    }
    return withSafeConfigurationErrors(async () => {
      if (!this.removeInstallation) {
        throw new Error("Nettoyage non configuré.");
      }
      return this.removeInstallation(installationId, githubUserId);
    }, "Impossible de supprimer les configurations des experts de cette installation.");
  }

  private validateScope(
    installationId: number,
    intention: ExpertIntention,
  ): void {
    assertPositiveId(installationId);
    assertExpertIntention(intention);
  }

  private serviceFor(intention: ExpertIntention): LlmConfigurationService {
    let service = this.services.get(intention);
    if (!service) {
      service = new LlmConfigurationService(
        this.repositoryForIntention(intention),
        this.cipher,
      );
      this.services.set(intention, service);
    }
    // Seules les instances de service sont mémorisées, jamais les clés résolues
    // ni les configurations : chaque lecture consulte le repository.
    return service;
  }
}
