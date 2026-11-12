import type { WebSession } from "../auth/web-auth.js";
import type { ExpertConfigurationSummary } from "../configuration/expert-configuration.js";
import {
  EXPERT_DEFINITIONS,
  type ExpertIntention,
} from "../configuration/expert-definitions.js";
import { LLM_PROVIDER_DEFINITIONS } from "../llm/provider-configuration.js";
import { escapeHtml, renderPage } from "./html.js";
import { renderLlmSettingsForm } from "./llm-settings-form.js";

export function renderExpertLinks(installationId: number): string {
  return `<section class="card">
    <h2>Experts IA par intention</h2>
    <p>Choisissez le fournisseur, le modèle et la clé API de chaque expert disponible.</p>
    <div class="actions">${Object.entries(EXPERT_DEFINITIONS)
      .map(
        ([intention, definition]) =>
          `<a class="button secondary" href="/settings/${installationId}/experts/${intention}">Configurer l’expert ${escapeHtml(definition.displayName)}</a>`,
      )
      .join("")}</div>
    <small>Seul l’expert Bug est configurable pour le moment.</small>
  </section>`;
}

export function renderExpertSettingsPage(options: {
  installationId: number;
  intention: ExpertIntention;
  session: WebSession;
  configuration: ExpertConfigurationSummary | null;
  notice?: string;
  error?: string;
}): string {
  const { installationId, intention, configuration, session } = options;
  const definition = EXPERT_DEFINITIONS[intention];
  const path = `/settings/${installationId}/experts/${intention}`;
  return renderPage(
    `Expert ${definition.displayName}`,
    `<section class="card">
    <h1>Configuration de l’expert ${escapeHtml(definition.displayName)}</h1>
    <p>Installation GitHub <code>#${installationId}</code> — connecté en tant que <strong>${escapeHtml(session.githubLogin)}</strong></p>
    <div class="notice">La configuration enregistrée est utilisée à la prochaine analyse d’une PR classée Bug. Le diff et son contexte sont envoyés au fournisseur choisi. Une analyse déjà lancée conserve sa configuration initiale.</div>
    ${options.error ? `<div class="notice error">${escapeHtml(options.error)}</div>` : ""}
    ${options.notice ? `<div class="notice success">${escapeHtml(options.notice)}</div>` : ""}
    <p>Le test de connexion vérifie l’accès au modèle choisi. Il ne lance aucune revue et ne publie aucun commentaire GitHub.</p>
    ${renderLlmSettingsForm({
      configuration,
      csrfToken: session.csrfToken,
      saveUrl: `${path}/save`,
      testUrl: `/api/installations/${installationId}/experts/${intention}/llm/test`,
      backUrl: `/settings/${installationId}`,
      backLabel: "Retour aux paramètres",
      providers: definition.providers,
      defaultProvider: "gemini",
      showBaseUrl: false,
    })}
  </section>
  ${
    configuration
      ? `<section class="card">
    <h2>Configuration enregistrée</h2>
    <p>${escapeHtml(LLM_PROVIDER_DEFINITIONS[configuration.provider].displayName)} — <code>${escapeHtml(configuration.model)}</code> — clé terminant par <code>${escapeHtml(configuration.keyLastFour)}</code></p>
    <p class="muted">Dernière modification : ${escapeHtml(configuration.updatedAt.toLocaleString("fr-CA"))}</p>
    <form method="post" action="${path}/delete">
      <p>Après suppression, l’expert utilisera le repli Gemini du serveur, s’il est configuré.</p>
      <input type="hidden" name="_csrf" value="${escapeHtml(session.csrfToken)}">
      <button class="danger" type="submit">Supprimer la configuration de cet expert</button>
    </form>
  </section>`
      : `<section class="card"><p>Aucune configuration enregistrée pour cet expert. Le repli Gemini du serveur sera utilisé s’il est configuré ; sinon, la revue spécialisée sera ignorée et signalée dans le commentaire d’analyse.</p></section>`
  }
  <script src="/assets/settings.js" defer></script>`,
  );
}
