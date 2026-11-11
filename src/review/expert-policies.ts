export type ExpertPolicy = {
  intent: string;
  roleTitle: string;
  classifiedAs: string;
  reviewPolicy: string;
};

const POLICIES = new Map<string, ExpertPolicy>();

export function registerExpertPolicy(policy: ExpertPolicy): void {
  POLICIES.set(policy.intent.toLowerCase(), policy);
}

export function getExpertPolicy(intent: string): ExpertPolicy | undefined {
  return POLICIES.get(intent.trim().toLowerCase());
}

export function isRegisteredIntent(intent: string): boolean {
  return POLICIES.has(intent.trim().toLowerCase());
}

export function registeredIntents(): string[] {
  return [...POLICIES.keys()];
}

registerExpertPolicy({
  intent: "bug",
  roleTitle: "bug-fix Pull Requests",
  classifiedAs: "a bug fix",
  reviewPolicy: `- Verify whether the implementation actually fixes the described bug.
- Report only concrete correctness defects, regressions or unhandled edge cases supported by the visible diff.`,
});
