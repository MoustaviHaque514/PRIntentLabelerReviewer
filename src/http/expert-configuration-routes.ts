import type { Request, Response, Router } from "express";
import type { WebSession } from "../auth/web-auth.js";
import { getGitHubOAuthService } from "../auth/runtime.js";
import { getExpertConfigurationService } from "../configuration/expert-configuration-runtime.js";
import {
  ExpertConfigurationUnavailableError,
  type TestExpertConfigurationInput,
} from "../configuration/expert-configuration.js";
import {
  assertExpertProvider,
  isExpertIntention,
  type ExpertIntention,
} from "../configuration/expert-definitions.js";
import { LlmProviderRequestError } from "../llm/provider-error.js";
import {
  configurationInput,
  csrfMatches,
  parsePositiveInteger,
  readCookie,
  SESSION_COOKIE,
} from "./configuration-request.js";
import { renderErrorPage } from "./html.js";
import { renderExpertSettingsPage } from "./expert-settings-page.js";

type ExpertConfigurationScope = {
  installationId: number;
  intention: ExpertIntention;
  session: WebSession;
};

function sendErrorResponse(
  res: Response,
  status: number,
  message: string,
  json: boolean,
): void {
  if (json) {
    res.status(status).json({ message });
  } else {
    res.status(status).send(renderErrorPage(message, status));
  }
}

async function authorize(
  req: Request,
  res: Response,
  json = false,
): Promise<ExpertConfigurationScope | null> {
  res.setHeader("Cache-Control", "no-store");
  const installationId = parsePositiveInteger(req.params.installationId);
  let session: WebSession | null = null;
  try {
    const oauth = getGitHubOAuthService();
    const token = readCookie(req, SESSION_COOKIE);
    if (oauth && token) {
      session = await oauth.getSession(token);
    }
  } catch {
    sendErrorResponse(
      res,
      503,
      "Le service d’authentification est indisponible.",
      json,
    );
    return null;
  }
  if (!session && req.method === "GET") {
    let authenticationUrl = "/auth/github";
    if (installationId) {
      authenticationUrl += `?installation_id=${installationId}`;
    }
    res.redirect(authenticationUrl);
    return null;
  }
  if (
    !session ||
    !installationId ||
    !session.installationIds.includes(installationId)
  ) {
    sendErrorResponse(res, 403, "Autorisation invalide ou expirée.", json);
    return null;
  }
  if (req.method !== "GET" && !csrfMatches(session, req.body?._csrf)) {
    sendErrorResponse(res, 403, "Autorisation invalide ou expirée.", json);
    return null;
  }
  if (!isExpertIntention(req.params.intention)) {
    sendErrorResponse(
      res,
      404,
      "Cette intention n’est pas configurable.",
      json,
    );
    return null;
  }
  return { installationId, intention: req.params.intention, session };
}

function expertInput(
  scope: ExpertConfigurationScope,
  body: Record<string, unknown>,
): TestExpertConfigurationInput {
  const input = configurationInput(scope.installationId, body);
  const provider = input.provider;
  assertExpertProvider(scope.intention, provider);
  return { ...input, provider, intention: scope.intention };
}

// Messages applicatifs autorisés ; aucune erreur brute d'OAuth, SQL ou API ne
// doit être renvoyée au navigateur, même si elle contient la clé saisie.
const PUBLIC_MESSAGES = new Set([
  "Le fournisseur sélectionné est invalide.",
  "Ce fournisseur n’est pas autorisé pour cet expert.",
  "Le nom du modèle est trop long.",
  "La clé API est trop longue.",
  "L’URL de base est trop longue.",
  "Une URL personnalisée n’est pas autorisée pour cet expert.",
  "La clé API est requise.",
  "Une nouvelle clé API est requise lors du changement de fournisseur.",
]);

function publicMessage(error: unknown): string {
  if (error instanceof LlmProviderRequestError) {
    return `Le fournisseur a refusé la connexion (${error.status}).`;
  }
  if (error instanceof Error && PUBLIC_MESSAGES.has(error.message)) {
    return error.message;
  }
  return "L’opération a échoué. Vérifiez la configuration et réessayez.";
}

export function registerExpertConfigurationRoutes(router: Router): void {
  const path = "/settings/:installationId/experts/:intention";
  router.get(path, async (req, res) => {
    const scope = await authorize(req, res);
    if (!scope) return;
    try {
      const configuration = await getExpertConfigurationService().getSummary(
        scope.installationId,
        scope.intention,
      );
      let notice: string | undefined;
      if (req.query.saved === "1") {
        notice =
          "Configuration testée et enregistrée. Elle sera utilisée à la prochaine analyse d’une PR classée Bug.";
      } else if (req.query.deleted === "1") {
        notice = "La configuration de cet expert a été supprimée.";
      }
      res.send(
        renderExpertSettingsPage({
          ...scope,
          configuration,
          notice,
        }),
      );
    } catch {
      sendErrorResponse(
        res,
        503,
        "La configuration des experts est indisponible. Vérifiez la connexion à la base et les migrations.",
        false,
      );
    }
  });

  router.post(
    "/api/installations/:installationId/experts/:intention/llm/test",
    async (req, res) => {
      const scope = await authorize(req, res, true);
      if (!scope) return;
      try {
        await getExpertConfigurationService().test(
          expertInput(scope, req.body ?? {}),
        );
        res.json({
          message:
            "Connexion au fournisseur réussie. Aucune configuration enregistrée par ce test.",
        });
      } catch (error) {
        sendErrorResponse(
          res,
          error instanceof ExpertConfigurationUnavailableError ? 503 : 400,
          publicMessage(error),
          true,
        );
      }
    },
  );

  router.post(`${path}/save`, async (req, res) => {
    const scope = await authorize(req, res);
    if (!scope) return;
    try {
      await getExpertConfigurationService().save({
        ...expertInput(scope, req.body ?? {}),
        githubUserId: scope.session.githubUserId,
      });
      res.redirect(
        `/settings/${scope.installationId}/experts/${scope.intention}?saved=1`,
      );
    } catch (error) {
      if (error instanceof ExpertConfigurationUnavailableError) {
        sendErrorResponse(
          res,
          503,
          "Le service de configuration des experts est indisponible.",
          false,
        );
        return;
      }
      try {
        const configuration = await getExpertConfigurationService().getSummary(
          scope.installationId,
          scope.intention,
        );
        res.status(400).send(
          renderExpertSettingsPage({
            ...scope,
            configuration,
            error: publicMessage(error),
          }),
        );
      } catch {
        sendErrorResponse(
          res,
          503,
          "Impossible de charger la configuration de cet expert.",
          false,
        );
      }
    }
  });

  router.post(`${path}/delete`, async (req, res) => {
    const scope = await authorize(req, res);
    if (!scope) return;
    try {
      await getExpertConfigurationService().delete(
        scope.installationId,
        scope.intention,
        scope.session.githubUserId,
      );
      res.redirect(
        `/settings/${scope.installationId}/experts/${scope.intention}?deleted=1`,
      );
    } catch {
      sendErrorResponse(
        res,
        503,
        "Impossible de supprimer la configuration de cet expert.",
        false,
      );
    }
  });
}
