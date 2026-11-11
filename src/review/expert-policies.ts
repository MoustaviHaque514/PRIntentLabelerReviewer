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

registerExpertPolicy({
  intent: "feature",
  roleTitle: "feature Pull Requests",
  classifiedAs: "a new user-facing feature",
  reviewPolicy: `- Verify whether the implemented change actually delivers the described feature.
- Report missing edge cases, incomplete wiring, broken contracts or behaviour that contradicts the stated feature.
- Do not treat supporting tests or docs as separate defects unless they make the feature incorrect.`,
});

registerExpertPolicy({
  intent: "refactor",
  roleTitle: "refactor Pull Requests",
  classifiedAs: "a behaviour-preserving refactor",
  reviewPolicy: `- Verify that the refactor preserves observable behaviour.
- Report accidental behaviour changes, broken call sites, incomplete extractions or duplicated logic left behind.
- Do not request stylistic rewrites unrelated to the refactor's stated goal.`,
});

registerExpertPolicy({
  intent: "documentation",
  roleTitle: "documentation Pull Requests",
  classifiedAs: "a documentation change",
  reviewPolicy: `- Verify that the documentation matches the visible change and remains accurate.
- Report missing, contradictory or outdated explanations, broken references and examples that cannot work as written.
- Do not request code refactors when the Pull Request is documentation-only.`,
});

registerExpertPolicy({
  intent: "tests",
  roleTitle: "test-suite Pull Requests",
  classifiedAs: "a test-only change",
  reviewPolicy: `- Verify that the tests assert the intended behaviour and would fail for the bug or contract they claim to cover.
- Report missing assertions, tests that cannot fail, brittle setup, or coverage holes in the changed suite.
- Do not request production-code features unless the tests themselves are incorrect.`,
});

registerExpertPolicy({
  intent: "ci-cd",
  roleTitle: "CI/CD and build Pull Requests",
  classifiedAs: "a CI/CD or build change",
  reviewPolicy: `- Verify workflows, Dockerfiles and build scripts against the stated pipeline goal.
- Report broken triggers, missing secrets usage, unsafe permissions, cache mistakes or commands that cannot succeed as written.
- Do not request application feature work unless the pipeline change itself is incorrect.`,
});

registerExpertPolicy({
  intent: "dependencies",
  roleTitle: "dependency Pull Requests",
  classifiedAs: "a dependency change",
  reviewPolicy: `- Verify that version bumps, lockfile updates and package-manager migrations are consistent.
- Report mismatched lockfiles, accidental major upgrades, missing peer constraints or unused dependency edits.
- Do not treat changelog text from upstream packages as a bug fix implemented by this repository.`,
});

registerExpertPolicy({
  intent: "performance",
  roleTitle: "performance Pull Requests",
  classifiedAs: "a performance improvement",
  reviewPolicy: `- Verify that the change actually improves time, memory or resource use in the visible diff.
- Report remaining quadratic paths, missing caches, extra allocations or claims without supporting code.
- Do not request unrelated architecture rewrites.`,
});

registerExpertPolicy({
  intent: "security",
  roleTitle: "security Pull Requests",
  classifiedAs: "a security-related change",
  reviewPolicy: `- Verify authentication, authorization, secret handling and input validation in the visible diff.
- Report remaining trust-boundary gaps, leaked secrets, missing checks or bypasses.
- Do not report generic hardening ideas unsupported by the changed code.`,
});

registerExpertPolicy({
  intent: "breaking-change",
  roleTitle: "breaking-change Pull Requests",
  classifiedAs: "a breaking change",
  reviewPolicy: `- Verify that incompatibilities are real, explicit and reflected in public contracts.
- Report silent removals, renamed APIs without migration notes, or incomplete call-site updates in the diff.
- Do not treat an internal refactor as breaking unless a public contract changed.`,
});
