import type { LlmConfigurationSummary } from "../configuration/llm-configuration.js";
import {
  LLM_PROVIDER_DEFINITIONS,
  LLM_PROVIDER_NAMES,
  type LlmProviderName,
} from "../llm/provider-configuration.js";
import { escapeHtml } from "./html.js";

type LlmSettingsFormOptions = {
  configuration: LlmConfigurationSummary | null;
  csrfToken: string;
  saveUrl: string;
  testUrl: string;
  backUrl: string;
  backLabel: string;
  providers?: readonly LlmProviderName[];
  defaultProvider?: LlmProviderName;
  showBaseUrl?: boolean;
};

export function renderLlmSettingsForm(options: LlmSettingsFormOptions): string {
  const providers = options.providers ?? LLM_PROVIDER_NAMES;
  const selectedProvider =
    options.configuration?.provider ?? options.defaultProvider ?? "groq";
  const model =
    options.configuration?.model ??
    LLM_PROVIDER_DEFINITIONS[selectedProvider].defaultModel;
  const suggestedModels = new Set(
    providers.flatMap(
      (provider) => LLM_PROVIDER_DEFINITIONS[provider].suggestedModels,
    ),
  );
  const providerOptions = providers
    .map((provider) => {
      const selected = provider === selectedProvider ? " selected" : "";
      const displayName = LLM_PROVIDER_DEFINITIONS[provider].displayName;
      return `<option value="${provider}"${selected}>${escapeHtml(displayName)}</option>`;
    })
    .join("");
  const modelSuggestions = [...suggestedModels]
    .map(
      (suggestedModel) =>
        `<option value="${escapeHtml(suggestedModel)}"></option>`,
    )
    .join("");

  return `<form id="llm-settings-form" method="post"
      action="${escapeHtml(options.saveUrl)}" data-test-url="${escapeHtml(options.testUrl)}"
      data-stored-provider="${escapeHtml(options.configuration?.provider ?? "")}">
    <input type="hidden" name="_csrf" value="${escapeHtml(options.csrfToken)}">
    <label for="provider">Fournisseur</label>
    <select id="provider" name="provider" required>
      ${providerOptions}
    </select>
    <label for="model">Modèle</label>
    <input id="model" name="model" list="known-models" value="${escapeHtml(model)}" maxlength="160" required>
    <datalist id="known-models">${modelSuggestions}</datalist>
    <small>Un modèle suggéré peut être sélectionné ou un identifiant exact peut être saisi.</small>
    <label for="apiKey">${options.configuration ? "Nouvelle clé API" : "Clé API"}</label>
    <input id="apiKey" name="apiKey" type="password" autocomplete="new-password" maxlength="4096" ${options.configuration ? "" : "required"}>
    <small>${
      options.configuration
        ? "Laisser vide pour conserver la clé actuelle. La clé enregistrée ne peut pas être réaffichée."
        : "La clé sera testée, puis chiffrée avant son enregistrement."
    }</small>
    <small>Un changement de fournisseur nécessite une nouvelle clé API.</small>
    ${
      options.showBaseUrl === false
        ? ""
        : `<label for="baseUrl">URL de base personnalisée</label>
    <input id="baseUrl" name="baseUrl" type="url" value="${escapeHtml(options.configuration?.baseUrl ?? "")}" maxlength="2048" placeholder="https://llm.exemple.ca/v1">
    <small>Requise seulement pour une API compatible OpenAI personnalisée.</small>`
    }
    <div id="connection-result" aria-live="polite"></div>
    <div class="actions">
      <button type="button" class="secondary" id="test-connection">Tester la connexion</button>
      <button type="submit">Enregistrer</button>
      <a class="button secondary" href="${escapeHtml(options.backUrl)}">${escapeHtml(options.backLabel)}</a>
    </div>
  </form>`;
}

export function renderSettingsClientScript(): string {
  const defaults = Object.fromEntries(
    LLM_PROVIDER_NAMES.map((name) => [
      name,
      {
        model: LLM_PROVIDER_DEFINITIONS[name].defaultModel,
        models: LLM_PROVIDER_DEFINITIONS[name].suggestedModels,
        baseUrl: LLM_PROVIDER_DEFINITIONS[name].defaultBaseUrl ?? "",
      },
    ]),
  );

  return `"use strict";
const defaults = ${JSON.stringify(defaults)};
const form = document.getElementById("llm-settings-form");
if (form) {
  const provider = document.getElementById("provider");
  const model = document.getElementById("model");
  const baseUrl = document.getElementById("baseUrl");
  const testButton = document.getElementById("test-connection");
  const result = document.getElementById("connection-result");
  const apiKey = document.getElementById("apiKey");
  const suggestions = document.getElementById("known-models");
  let previousProvider = provider.value;

  function updateProviderFields() {
    const suggestedModels = defaults[provider.value]?.models || [];
    const modelOptions = suggestedModels.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      return option;
    });
    suggestions.replaceChildren(...modelOptions);
    const providerChanged = provider.value !== form.dataset.storedProvider;
    apiKey.required = !form.dataset.storedProvider || providerChanged;
  }
  updateProviderFields();

  provider.addEventListener("change", () => {
    const previousDefault = defaults[previousProvider]?.model || "";
    if (!model.value || model.value === previousDefault) {
      model.value = defaults[provider.value]?.model || "";
    }
    if (provider.value === "custom" && baseUrl && !baseUrl.value) {
      baseUrl.focus();
    }
    previousProvider = provider.value;
    updateProviderFields();
    result.textContent = "";
  });

  testButton.addEventListener("click", async () => {
    if (!form.reportValidity()) return;
    result.className = "notice";
    result.textContent = "Test de la connexion en cours…";
    testButton.disabled = true;
    try {
      const response = await fetch(form.dataset.testUrl, {
        method: "POST",
        body: new URLSearchParams(new FormData(form)),
        headers: { Accept: "application/json" }
      });
      const payload = await response.json();
      result.className = response.ok ? "notice success" : "notice error";
      result.textContent = payload.message || "Réponse inattendue du serveur.";
    } catch {
      result.className = "notice error";
      result.textContent = "Le serveur de configuration est inaccessible.";
    } finally {
      testButton.disabled = false;
    }
  });
}`;
}
