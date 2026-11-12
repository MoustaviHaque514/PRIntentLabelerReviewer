import { getDatabasePool } from "../database/pool.js";
import { ApiKeyCipher } from "../security/api-key-cipher.js";
import { ExpertConfigurationUnavailableError } from "./expert-configuration.js";
import { ExpertConfigurationService } from "./expert-configuration-service.js";
import { PostgresExpertConfigurationRepository } from "./postgres-expert-configuration-repository.js";

let service: ExpertConfigurationService | undefined;

// Une configuration serveur absente est une indisponibilité du service,
// pas une absence de configuration d'expert autorisant un repli.
export function getExpertConfigurationService(): ExpertConfigurationService {
  if (service) {
    return service;
  }

  try {
    const encryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new ExpertConfigurationUnavailableError();
    }
    const cipher = new ApiKeyCipher(encryptionKey);
    const pool = getDatabasePool();
    if (!pool) {
      throw new ExpertConfigurationUnavailableError();
    }

    service = new ExpertConfigurationService(
      (intention) => new PostgresExpertConfigurationRepository(pool, intention),
      cipher,
      (installationId, githubUserId) =>
        PostgresExpertConfigurationRepository.deleteForInstallation(
          pool,
          installationId,
          githubUserId,
        ),
    );
    return service;
  } catch {
    throw new ExpertConfigurationUnavailableError();
  }
}

export function resetExpertConfigurationServiceForTests(): void {
  service = undefined;
}
