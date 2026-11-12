import type { Context } from "probot";
import { getLlmConfigurationService } from "../configuration/runtime.js";
import { getExpertConfigurationService } from "../configuration/expert-configuration-runtime.js";

export async function handleInstallationDeleted(
  context: Context<"installation">,
): Promise<void> {
  const installationId = context.payload.installation.id;
  // Chaque nettoyage doit être tenté même si l'autre service est indisponible.
  try {
    const classifier = getLlmConfigurationService();
    if (classifier) {
      await classifier.delete(installationId);
      context.log.info(
        { installationId },
        "Deleted LLM configuration for uninstalled app",
      );
    }
  } catch {
    context.log.error(
      { installationId },
      "Failed to delete LLM configuration after uninstall",
    );
  }
  try {
    const deletedCount =
      await getExpertConfigurationService().deleteForInstallation(
        installationId,
      );
    context.log.info(
      { installationId, deletedCount },
      "Deleted expert configurations for uninstalled app",
    );
  } catch {
    context.log.error(
      { installationId },
      "Failed to delete expert configurations after uninstall",
    );
  }
}
