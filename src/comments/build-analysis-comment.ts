import type {
  PullRequestData,
  PullRequestLlmContext,
} from "../domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import type { BugReviewResult } from "../domain/code-review.js";
import {
  BOT_COMMENT_MARKER,
  formatFileScore,
  MAX_FILES_IN_COMMENT,
  MIN_CONFIDENCE_TO_SUGGEST,
} from "../utils/constants.js";
import { toAiLabelName } from "../labels/ai-label-name.js";
import {
  renderAnalysisDataBlock,
  renderCheckboxLines,
} from "./comment-state.js";

export function buildAnalysisComment(
  prData: PullRequestData,
  context: PullRequestLlmContext,
  analysis: PullRequestAnalysis | null = null,
  appliedLabels: string[] = [],
  llmFailureReason: string | null = null,
  bugReview: BugReviewResult | null = null,
  bugReviewFailure: string | null = null,
): string {
  const selected = context.selectedFiles.slice(0, MAX_FILES_IN_COMMENT);

  const selectedTable =
    selected.length > 0
      ? selected
          .map((ranked) => {
            const f = ranked.file;
            const reasons = ranked.reasons.join(", ") || "—";
            return `| \`${f.filename}\` | ${f.status} | +${f.additions}/-${f.deletions} | ${formatFileScore(ranked.score)} | ${reasons} |`;
          })
          .join("\n")
      : "| _Aucun fichier sélectionné_ | | | | |";

  const filesSection = `### Fichiers sélectionnés pour l'analyse

> Les fichiers ci-dessous ont été sélectionnés automatiquement par le backend et utilisés pour construire le contexte envoyé au LLM. Le score est une priorité interne de tri (diagnostic), il n'est jamais envoyé au LLM.

| Fichier | Statut | Changements | Score | Raisons |
|---|---|---|---|---|
${selectedTable}`;

  const labelsSection = buildLabelsSection(
    prData,
    analysis,
    appliedLabels,
    llmFailureReason,
  );

  const summarySection =
    analysis && analysis.summary
      ? `\n###  Résumé\n\n${analysis.summary}\n`
      : "";

  const dataBlock = analysis
    ? `\n${renderAnalysisDataBlock(analysis, prData.headSha)}`
    : "";
  const bugReviewSection =
    bugReview || bugReviewFailure
      ? `\n${buildBugReviewSection(prData, bugReview, bugReviewFailure)}`
      : "";

  return `${BOT_COMMENT_MARKER}
##  LLM PR Labeler — Analyse

L'application a bien reçu et analysé cette Pull Request.

| Champ | Valeur |
|---|---|
| PR | #${prData.number} |
| Titre | ${escapeMarkdownTableValue(prData.title)} |
| Auteur | \`${prData.author}\` |
| Branche source | \`${prData.headBranch}\` |
| Branche cible | \`${prData.baseBranch}\` |
| Changements | +${prData.additions} / -${prData.deletions} |
| Fichiers modifiés | ${prData.changedFilesCount} |
| Fichiers analysés par le LLM | ${context.selectedFilesCount} |
| Fichiers résumés seulement (lockfile/snapshot/généré) | ${context.summaryOnlyFilesCount} |

${filesSection}

${labelsSection}${summarySection}${bugReviewSection}${dataBlock}`;
}

function buildBugReviewSection(
  prData: PullRequestData,
  review: BugReviewResult | null,
  failure: string | null,
): string {
  if (!review) {
    return `### Revue spécialisée — Bug\n\n> La revue Gemini n'a pas abouti : ${escapeModelText(failure ?? "erreur inconnue")}\n`;
  }

  if (review.findings.length === 0) {
    return `### Revue spécialisée — Bug\n\n**Verdict : correction validée**\n\n${escapeModelText(review.summary)}\n\n> Aucun changement supplémentaire n'est demandé pour le diff analysé (\`${prData.headSha.slice(0, 7)}\`).\n`;
  }

  const findings = review.findings
    .map((finding, index) => {
      const path = encodeURIComponent(finding.file).replace(/%2F/gi, "/");
      const lineRange =
        finding.startLine === finding.endLine
          ? `L${finding.startLine}`
          : `L${finding.startLine}-L${finding.endLine}`;
      const url = `https://github.com/${encodeURIComponent(prData.owner)}/${encodeURIComponent(prData.repo)}/blob/${encodeURIComponent(prData.headSha)}/${path}#${lineRange}`;
      return `${index + 1}. **${finding.severity.toUpperCase()} — [\`${finding.file}:${lineRange}\`](${url})**\n   - ${escapeModelText(finding.message)}\n   - **Changement proposé :** ${escapeModelText(finding.suggestion)}`;
    })
    .join("\n\n");

  return `### Revue spécialisée — Bug\n\n**Verdict : changements demandés**\n\n${escapeModelText(review.summary)}\n\n${findings}\n`;
}

function buildLabelsSection(
  prData: PullRequestData,
  analysis: PullRequestAnalysis | null,
  appliedLabels: string[],
  llmFailureReason: string | null,
): string {
  if (analysis && analysis.suggestions.length > 0) {
    const checkboxes = renderCheckboxLines(analysis.suggestions, appliedLabels);
    const appliedNote =
      appliedLabels.length > 0
        ? `\n\n> ${appliedLabels.length} label(s) actuellement appliqué(s) : ${appliedLabels
            .map((label) => `\`${toAiLabelName(label)}\``)
            .join(", ")}.`
        : "\n\n> Aucun label appliqué pour l'instant.";

    return `###  Labels suggérés — coche ceux à appliquer

> Coche/décoche une case pour appliquer ou retirer le label correspondant sur cette PR.
> Un label appliqué par l'IA porte toujours l'icône 🤖 devant son nom (ex. \`🤖 bug\`) pour le distinguer d'un label ajouté manuellement par un humain, qui n'affiche jamais cette icône.

${checkboxes}${appliedNote}`;
  }

  const availableLabels =
    prData.repositoryLabels.length > 0
      ? prData.repositoryLabels.map((label) => `\`${label}\``).join(", ")
      : "_Aucun label trouvé dans le repo._";

  // Une analyse absente (panne du fournisseur) et une analyse aboutie sans
  // label retenu produisaient le même message : impossible de savoir laquelle.
  const reason = analysis
    ? `Le LLM a analysé cette PR mais aucun label du repo n'a atteint le seuil de confiance de ${Math.round(MIN_CONFIDENCE_TO_SUGGEST * 100)} %.`
    : (llmFailureReason ?? "L'analyse LLM n'a pas abouti.");

  return `### Labels disponibles dans le repo

${availableLabels}

>  ${reason}`;
}

function escapeMarkdownTableValue(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeModelText(value: string): string {
  return value
    .replace(/@/g, "@\u200b")
    .replace(/<!--/g, "&lt;!--")
    .replace(/\r?\n/g, " ")
    .trim();
}
