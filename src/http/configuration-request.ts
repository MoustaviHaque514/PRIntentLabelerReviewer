import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { WebSession } from "../auth/web-auth.js";
import type { TestLlmConfigurationInput } from "../configuration/llm-configuration.js";
import { isLlmProviderName } from "../llm/provider-configuration.js";

export const SESSION_COOKIE = "pril_session";

export function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function csrfMatches(session: WebSession, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const expected = Buffer.from(session.csrfToken);
  const received = Buffer.from(value);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export function configurationInput(
  installationId: number,
  body: Record<string, unknown>,
): TestLlmConfigurationInput {
  if (!isLlmProviderName(body.provider)) {
    throw new Error("Le fournisseur sélectionné est invalide.");
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";

  if (model.length > 160) throw new Error("Le nom du modèle est trop long.");
  if (apiKey.length > 4096) throw new Error("La clé API est trop longue.");
  if (baseUrl.length > 2048) throw new Error("L’URL de base est trop longue.");

  return {
    installationId,
    provider: body.provider,
    model,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
  };
}
