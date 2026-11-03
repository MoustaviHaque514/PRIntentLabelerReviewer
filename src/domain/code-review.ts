export type ReviewSeverity = "info" | "warning" | "error";

export type CodeReviewFinding = {
  file: string;
  startLine: number;
  endLine: number;
  severity: ReviewSeverity;
  message: string;
  suggestion: string;
};

export type BugReviewResult = {
  verdict: "approved" | "changes-requested";
  summary: string;
  findings: CodeReviewFinding[];
};
