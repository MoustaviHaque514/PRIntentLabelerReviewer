import type { WebSession } from "../auth/web-auth.js";
import type { LlmConfigurationSummary } from "../configuration/llm-configuration.js";
import { LLM_PROVIDER_DEFINITIONS } from "../llm/provider-configuration.js";
import { renderLlmSettingsForm } from "./llm-settings-form.js";
export { renderSettingsClientScript } from "./llm-settings-form.js";
import { renderExpertLinks } from "./expert-settings-page.js";
import { escapeHtml, renderPage } from "./html.js";

type SettingsPageOptions = {
  installationId: number;
  session: WebSession;
  configuration: LlmConfigurationSummary | null;
  notice?: string;
  error?: string;
};

export function renderSettingsPage(options: SettingsPageOptions): string {
  const selectedProvider = options.configuration?.provider ?? "groq";
  const selectedDefinition = LLM_PROVIDER_DEFINITIONS[selectedProvider];

  const message = options.error
    ? `<div class="notice error">${escapeHtml(options.error)}</div>`
    : options.notice
      ? `<div class="notice success">${escapeHtml(options.notice)}</div>`
      : "";

  const configured = options.configuration
    ? `<section class="card">
        <h2>Configuration actuelle</h2>
        <p>
          ${escapeHtml(selectedDefinition.displayName)} —
          <code>${escapeHtml(options.configuration.model)}</code> —
          clé terminant par <code>${escapeHtml(options.configuration.keyLastFour)}</code>
        </p>
        <p class="muted">
          Dernière modification :
          ${escapeHtml(options.configuration.updatedAt.toLocaleString("fr-CA"))}
        </p>
      </section>`
    : "";

  return renderPage(
    "Configuration LLM",
    `${renderExpertLinks(options.installationId)}
    <section class="card">
      <h1>Configuration de PRIntentLabeler</h1>
      <p>
        Installation GitHub <code>#${options.installationId}</code> —
        connecté en tant que <strong>${escapeHtml(options.session.githubLogin)}</strong>
      </p>
      ${message}
      <div class="notice">
        Le contenu des Pull Requests sélectionné par l’application sera envoyé
        au fournisseur choisi avec cette clé API.
      </div>

      <h2>Classifieur d’intention</h2>
      ${renderLlmSettingsForm({
        configuration: options.configuration,
        csrfToken: options.session.csrfToken,
        saveUrl: `/settings/${options.installationId}/save`,
        testUrl: `/api/installations/${options.installationId}/llm/test`,
        backUrl: "/settings",
        backLabel: "Changer d’installation",
      })}
    </section>

    ${configured}

    ${
      options.configuration
        ? `<section class="card">
            <h2>Supprimer la configuration</h2>
            <p>L’analyse LLM utilisera ensuite la configuration Groq du serveur, si elle existe.</p>
            <form method="post" action="/settings/${options.installationId}/delete">
              <input type="hidden" name="_csrf" value="${escapeHtml(options.session.csrfToken)}">
              <button class="danger" type="submit">Supprimer la clé et la configuration</button>
            </form>
          </section>`
        : ""
    }

    <script src="/assets/settings.js" defer></script>`,
  );
}

export function renderInstallationsPage(
  session: WebSession,
  notice?: string,
): string {
  const installations =
    session.installationIds.length > 0
      ? `<ul class="installations">${session.installationIds
          .map(
            (id) =>
              `<li><a class="button secondary" href="/settings/${id}">Installation GitHub #${id}</a></li>`,
          )
          .join("")}</ul>`
      : `<div class="notice error">Aucune installation accessible n’a été trouvée pour ce compte.</div>`;

  return renderPage(
    "Installations",
    `<section class="card">
      <h1>Installations PRIntentLabeler</h1>
      <p>Connecté en tant que <strong>${escapeHtml(session.githubLogin)}</strong>.</p>
      ${notice ? `<div class="notice success">${escapeHtml(notice)}</div>` : ""}
      ${installations}
      <form method="post" action="/auth/logout">
        <input type="hidden" name="_csrf" value="${escapeHtml(session.csrfToken)}">
        <button type="submit" class="secondary">Se déconnecter</button>
      </form>
    </section>`,
  );
}
