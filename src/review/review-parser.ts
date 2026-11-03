import type {
  BugReviewResult,
  CodeReviewFinding,
  ReviewSeverity,
} from "../domain/code-review.js";
import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import { LlmInvalidResponseError } from "../llm/provider-error.js";

type FileLines = {
  visible: Set<number>;
  changed: Set<number>;
};

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const SEVERITIES = new Set<ReviewSeverity>(["info", "warning", "error"]);

function extractJsonObject(content: string): Record<string, unknown> {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end < start) {
    throw new LlmInvalidResponseError("aucun objet JSON de revue trouvé");
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("objet attendu");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LlmInvalidResponseError) throw error;
    throw new LlmInvalidResponseError("JSON de revue non analysable");
  }
}

function collectPatchLines(patch: string | undefined): FileLines {
  const result: FileLines = {
    visible: new Set<number>(),
    changed: new Set<number>(),
  };
  if (!patch) return result;

  let newLine: number | null = null;
  for (const line of patch.split("\n")) {
    const header = line.match(HUNK_HEADER);
    if (header) {
      newLine = Number.parseInt(header[1], 10);
      continue;
    }
    if (newLine === null || line.startsWith("\\")) continue;
    if (line.startsWith("-") && !line.startsWith("---")) continue;

    result.visible.add(newLine);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      result.changed.add(newLine);
    }
    newLine += 1;
  }
  return result;
}

function normalizeFinding(
  raw: unknown,
  linesByFile: Map<string, FileLines>,
): CodeReviewFinding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const finding = raw as Record<string, unknown>;
  const file = typeof finding.file === "string" ? finding.file.trim() : "";
  const startLine = finding.startLine;
  const endLine = finding.endLine;
  const severity = finding.severity;
  const message =
    typeof finding.message === "string" ? finding.message.trim() : "";
  const suggestion =
    typeof finding.suggestion === "string" ? finding.suggestion.trim() : "";
  const fileLines = linesByFile.get(file);

  if (
    !fileLines ||
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    (startLine as number) < 1 ||
    (endLine as number) < (startLine as number) ||
    typeof severity !== "string" ||
    !SEVERITIES.has(severity as ReviewSeverity) ||
    !message ||
    !suggestion
  ) {
    return null;
  }

  const start = startLine as number;
  const end = endLine as number;
  if (!fileLines.visible.has(start) || !fileLines.visible.has(end)) return null;

  const changedLines = [...fileLines.changed].filter(
    (line) => line >= start && line <= end,
  );
  if (changedLines.length === 0) return null;

  return {
    file,
    // GitHub accepte de façon fiable les commentaires ancrés sur le côté droit
    // lorsqu'ils ciblent une ligne ajoutée. On resserre donc une plage trop
    // large produite par le modèle sur les lignes réellement modifiées.
    startLine: Math.min(...changedLines),
    endLine: Math.max(...changedLines),
    severity: severity as ReviewSeverity,
    message,
    suggestion,
  };
}

export function parseBugReviewResult(
  content: string,
  context: PullRequestLlmContext,
): BugReviewResult {
  const parsed = extractJsonObject(content);
  const linesByFile = new Map(
    context.selectedFiles.map(({ file }) => [
      file.filename,
      collectPatchLines(file.patch),
    ]),
  );
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
        .map((finding) => normalizeFinding(finding, linesByFile))
        .filter((finding): finding is CodeReviewFinding => finding !== null)
    : [];

  return {
    verdict: findings.length === 0 ? "approved" : "changes-requested",
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : findings.length === 0
          ? "La correction ne présente aucun problème vérifiable dans le diff."
          : "La correction nécessite des changements.",
    findings,
  };
}
