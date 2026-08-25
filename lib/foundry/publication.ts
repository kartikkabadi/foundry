// Idempotent branch + PR publication for the multi-agent engineering system.
//
// Pure plan plus injected-effect driver. Planning is data-only:
//
//   - `planPublication` validates an operator-supplied publication request
//     against the shared authority model and returns a deeply frozen plan, or
//     a typed rejection. It never touches the filesystem, the network, or a
//     process.
//   - `decidePublicationStep` turns the plan plus a discovered branch/PR
//     snapshot into exactly one next command. It is the pure decision seam
//     that enforces exact-SHA, no-force-push, and create/update idempotency.
//   - `runPublication` is the thin driver that executes those commands through
//     injected effects: an argv-only git exec (`run`) plus a PR adapter
//     (`getPr`/`createPr`/`updatePr`). It re-discovers remote state before
//     every mutation and fails closed on any divergence.
//
// Safety properties (all enforced here, all exercised by tests):
//
//   - Exact-SHA: only the immutable verified head SHA may be published. The
//     driver re-checks the local HEAD and the remote branch against the plan
//     SHA before and after every mutation, and the push refspec pins the plan
//     SHA (`<headSha>:refs/heads/<branch>`), so a detached verified HEAD with a
//     stale local branch ref can never publish the wrong SHA.
//   - No force push: push is only ever issued for a missing remote branch, and
//     the push argv never contains a force flag. An existing branch at a
//     different SHA is a permanent rejection, never an overwrite.
//   - No merge/deploy: the plan rejects any non-"publish" intent, and the
//     command union contains no merge or deploy command, so publication can
//     never be driven into a merge or deploy effect.
//   - Create/update idempotency: create is issued only when no PR exists,
//     update only when the existing PR's content differs, and a re-run after
//     full success issues zero mutations.
//   - Retry: every retry re-discovers remote state first. A partially applied
//     push (remote moved, caller saw an error) is detected on the next
//     discovery and never re-applied.
//   - Duplicate effects: the driver fails closed if a mutation would be
//     applied twice with no observable state change (for example, when a push
//     "succeeded" but discovery still reports the branch missing).
//   - Input immutability: the plan is deeply frozen; planning and driving never
//     mutate their inputs.

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

export type RepositoryIdentity = {
  readonly owner: string;
  readonly repo: string;
};

export type VerificationVerdict = "passed" | "failed";

/** Immutable verification evidence, bound to the exact head SHA it proves. */
export type VerificationEvidence = {
  readonly verdict: VerificationVerdict;
  readonly headSha: string;
  readonly artifacts: readonly string[];
  readonly verifiedAt: string;
  readonly verifier: string;
};

/** Clean-workspace evidence: the working tree was clean at a known SHA. */
export type WorkspaceEvidence = {
  readonly headSha: string;
  readonly clean: boolean;
  readonly checkedAt: string;
};

export type PublishAction = "push" | "pr";

/** Explicit, durable authorization to publish a specific repository. */
export type PublishGrant = {
  readonly operator: string;
  readonly grantedAt: string;
  readonly scope: RepositoryIdentity;
  readonly actions: readonly PublishAction[];
  readonly nonce: string;
};

/**
 * Explicit discriminated authority model (never a bare boolean). A request is
 * publishable only when the authority is `granted`; `absent` and `revoked`
 * both fail closed.
 */
export type PublishAuthority =
  | { readonly kind: "granted"; readonly grant: PublishGrant }
  | { readonly kind: "absent"; readonly reason: string }
  | { readonly kind: "revoked"; readonly reason: string };

/** What the caller intends this request to accomplish. Only `publish` is safe. */
export type PublicationIntent = "publish" | "merge" | "deploy";

export type PublicationInput = {
  readonly repo: RepositoryIdentity;
  /** Namespaced branch, e.g. `agent/<slug>`; validated by the planner. */
  readonly branch: string;
  /** Immutable verified head SHA. Only this commit may be published. */
  readonly headSha: string;
  /** PR base branch. */
  readonly base: string;
  readonly title: string;
  readonly body: string;
  /** Git remote name the push targets. */
  readonly remote: string;
  readonly intent: PublicationIntent;
  readonly evidence: VerificationEvidence;
  readonly workspace: WorkspaceEvidence;
  readonly authority: PublishAuthority;
};

// ---------------------------------------------------------------------------
// Pure input validation
// ---------------------------------------------------------------------------

export const BRANCH_NAMESPACE = "agent/";

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Namespace + git-safety validation for a branch name. Returns an error or null. */
export function branchNamespaceError(branch: string): string | null {
  if (!branch.startsWith(BRANCH_NAMESPACE)) {
    return `branch must be namespaced under "${BRANCH_NAMESPACE}"`;
  }
  const name = branch.slice(BRANCH_NAMESPACE.length);
  if (name.length === 0) return "branch namespace requires a name after the prefix";
  if (!BRANCH_NAME_PATTERN.test(name)) return `branch name "${name}" contains invalid characters`;
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    return "branch name must not contain empty segments";
  }
  if (name.includes("..")) return "branch name must not contain '..' segments";
  if (name.includes("@{")) return "branch name must not contain '@{'";
  if (name.endsWith(".") || name.endsWith(".lock")) return "branch name must not end in '.' or '.lock'";
  return null;
}

/** Commit-SHA shape validation. Returns an error or null. */
export function shaError(sha: string): string | null {
  if (!SHA_PATTERN.test(sha)) {
    return `headSha must be a 40- or 64-char lowercase hex commit SHA, got "${sha}"`;
  }
  return null;
}

/** Repository-identity shape validation. Returns an error or null. */
export function repoError(repo: RepositoryIdentity): string | null {
  if (!repo.owner || /\s/.test(repo.owner)) return "repo owner must be a non-empty slug without whitespace";
  if (!repo.repo || /\s/.test(repo.repo)) return "repo name must be a non-empty slug without whitespace";
  return null;
}

/** Base-branch shape validation. Returns an error or null. */
export function baseError(base: string): string | null {
  if (!base || /\s/.test(base)) return "base branch must be a non-empty name without whitespace";
  return null;
}

// ---------------------------------------------------------------------------
// Plan and rejection
// ---------------------------------------------------------------------------

export type PublicationRejectCode =
  | "invalid-repo"
  | "invalid-branch"
  | "invalid-head-sha"
  | "invalid-base"
  | "invalid-remote"
  | "invalid-pr-content"
  | "merge-or-deploy-intent"
  | "missing-evidence"
  | "evidence-verdict-failed"
  | "evidence-sha-mismatch"
  | "dirty-workspace"
  | "workspace-sha-mismatch"
  | "authority-not-granted"
  | "authority-scope-mismatch"
  | "authority-action-not-granted";

export type PublicationRejection = {
  readonly ok: false;
  readonly code: PublicationRejectCode;
  readonly reason: string;
};

/**
 * Frozen, validated publication plan. Data only: the driver executes it through
 * injected effects. The `intent` literal is `"publish"`, so a plan can never
 * carry merge or deploy intent.
 */
export type PublicationPlan = {
  readonly ok: true;
  readonly repo: RepositoryIdentity;
  readonly branch: string;
  readonly headSha: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly remote: string;
  readonly intent: "publish";
  readonly evidence: Readonly<VerificationEvidence>;
  readonly workspace: Readonly<WorkspaceEvidence>;
  readonly authority: Readonly<PublishGrant>;
};

export type PublicationPlanResult = PublicationPlan | PublicationRejection;

function reject(code: PublicationRejectCode, reason: string): PublicationRejection {
  return { ok: false, code, reason };
}

/** Deep-freeze a plan so the driver can never accidentally mutate it. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Validate a publication request and produce the frozen plan. Pure: no I/O, no
 * mutation of the input. Rejections are typed and ordered so a caller can tell
 * exactly why publication was refused.
 */
export function planPublication(input: PublicationInput): PublicationPlanResult {
  const repoIssue = repoError(input.repo);
  if (repoIssue) return reject("invalid-repo", repoIssue);

  const branchIssue = branchNamespaceError(input.branch);
  if (branchIssue) return reject("invalid-branch", branchIssue);

  const shaIssue = shaError(input.headSha);
  if (shaIssue) return reject("invalid-head-sha", shaIssue);

  const baseIssue = baseError(input.base);
  if (baseIssue) return reject("invalid-base", baseIssue);

  if (!input.remote || /\s/.test(input.remote)) {
    return reject("invalid-remote", "remote must be a non-empty name without whitespace");
  }
  if (!input.title) return reject("invalid-pr-content", "PR title is required");

  if (input.intent !== "publish") {
    return reject(
      "merge-or-deploy-intent",
      `publication intent must be "publish", got "${input.intent}"`,
    );
  }

  // Verification evidence must exist, pass, and be bound to the exact head SHA.
  if (!input.evidence) return reject("missing-evidence", "verification evidence is required");
  if (input.evidence.verdict !== "passed") {
    return reject("evidence-verdict-failed", "verification verdict must be passed to publish");
  }
  if (input.evidence.headSha !== input.headSha) {
    return reject("evidence-sha-mismatch", "verification evidence is bound to a different SHA");
  }
  if (input.evidence.artifacts.length === 0) {
    return reject("missing-evidence", "verification evidence must include at least one artifact");
  }

  // Clean-workspace evidence must exist, be clean, and match the exact head SHA.
  if (!input.workspace) return reject("dirty-workspace", "clean-workspace evidence is required");
  if (!input.workspace.clean) {
    return reject("dirty-workspace", "workspace is not clean; refusing to publish");
  }
  if (input.workspace.headSha !== input.headSha) {
    return reject("workspace-sha-mismatch", "clean-workspace evidence is bound to a different SHA");
  }

  // Explicit publish authority: granted, scoped to this repo, and covering
  // both the push and the PR actions.
  if (input.authority.kind !== "granted") {
    return reject("authority-not-granted", input.authority.reason);
  }
  const grant = input.authority.grant;
  if (grant.scope.owner !== input.repo.owner || grant.scope.repo !== input.repo.repo) {
    return reject("authority-scope-mismatch", "publish authority is scoped to a different repository");
  }
  if (!grant.actions.includes("push") || !grant.actions.includes("pr")) {
    return reject("authority-action-not-granted", "publish authority must grant both push and pr actions");
  }

  const plan: PublicationPlan = {
    ok: true,
    repo: { ...input.repo },
    branch: input.branch,
    headSha: input.headSha,
    base: input.base,
    title: input.title,
    body: input.body,
    remote: input.remote,
    intent: "publish",
    evidence: { ...input.evidence, artifacts: [...input.evidence.artifacts] },
    workspace: { ...input.workspace },
    authority: { ...grant, scope: { ...grant.scope }, actions: [...grant.actions] },
  };
  return deepFreeze(plan);
}

// ---------------------------------------------------------------------------
// Pure decision seam over discovered state
// ---------------------------------------------------------------------------

export type BranchState =
  | { readonly kind: "missing" }
  | { readonly kind: "exists"; readonly headSha: string };

export type PrState =
  | { readonly kind: "missing" }
  | {
      readonly kind: "exists";
      readonly number: number;
      readonly headSha: string;
      readonly base: string;
      readonly title: string;
      readonly body: string;
    };

/** Snapshot of remote state, re-discovered before every mutation. */
export type DiscoveredState = {
  readonly branch: BranchState;
  readonly pr: PrState;
};

export type PublicationDecision =
  | { readonly kind: "push" }
  | { readonly kind: "create-pr" }
  | { readonly kind: "update-pr"; readonly number: number }
  | { readonly kind: "done"; readonly prNumber: number | null }
  | { readonly kind: "reject"; readonly reason: string };

/**
 * Decide the next publication step from the plan and a discovered snapshot.
 * Pure: no I/O, no mutation. The rules are what make publication safe:
 *
 *   - push only when the remote branch is missing (never over an existing one,
 *     so a force push is structurally impossible);
 *   - reject when the remote branch is at any SHA other than the verified head;
 *   - create only when no PR exists for the branch;
 *   - update only when the existing PR's head matches the verified SHA but its
 *     content differs; a fully matching PR is `done` (zero mutations), which is
 *     what makes re-runs after full success idempotent;
 *   - reject when the PR head has diverged from the verified SHA.
 */
export function decidePublicationStep(
  plan: PublicationPlan,
  discovered: DiscoveredState,
): PublicationDecision {
  if (discovered.branch.kind === "missing") {
    return { kind: "push" };
  }
  if (discovered.branch.headSha !== plan.headSha) {
    return {
      kind: "reject",
      reason:
        `remote branch "${plan.branch}" is at ${discovered.branch.headSha}, ` +
        `not the verified head ${plan.headSha}; publishing would require a force push`,
    };
  }
  if (discovered.pr.kind === "missing") {
    return { kind: "create-pr" };
  }
  if (discovered.pr.headSha !== plan.headSha) {
    return {
      kind: "reject",
      reason:
        `PR #${discovered.pr.number} head is at ${discovered.pr.headSha}, ` +
        `not the verified head ${plan.headSha}; refusing to update a diverged PR`,
    };
  }
  if (
    discovered.pr.base === plan.base &&
    discovered.pr.title === plan.title &&
    discovered.pr.body === plan.body
  ) {
    return { kind: "done", prNumber: discovered.pr.number };
  }
  return { kind: "update-pr", number: discovered.pr.number };
}

// ---------------------------------------------------------------------------
// Pure argv builders and ls-remote parsing
// ---------------------------------------------------------------------------

/**
 * Push argv. Pins the immutable verified head SHA in the refspec
 * (`<headSha>:refs/heads/<branch>`), so the push can never publish a stale
 * local branch ref when the workspace is a detached HEAD. Deliberately never
 * contains a force flag: the target ref must be missing (the decision seam
 * only issues a push for a missing remote branch), so a non-force push of the
 * exact SHA is sufficient and a force push is structurally impossible.
 */
export function pushArgv(remote: string, branch: string, headSha: string): string[] {
  return ["git", "push", remote, `${headSha}:refs/heads/${branch}`];
}

export function lsRemoteArgv(remote: string, branch: string): string[] {
  return ["git", "ls-remote", "--heads", remote, branch];
}

export function revParseArgv(): string[] {
  return ["git", "rev-parse", "HEAD"];
}

export function statusArgv(): string[] {
  return ["git", "status", "--porcelain"];
}

/** Parse `git ls-remote --heads <remote> <branch>` stdout into a BranchState. */
export function parseLsRemote(stdout: string, branch: string): BranchState {
  const ref = `refs/heads/${branch}`;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf("\t");
    if (tab < 0) continue;
    const sha = trimmed.slice(0, tab);
    const name = trimmed.slice(tab + 1);
    if (name === ref) return { kind: "exists", headSha: sha };
  }
  return { kind: "missing" };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export type CreatePrInput = {
  readonly repo: RepositoryIdentity;
  readonly branch: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly headSha: string;
};

export type UpdatePrInput = CreatePrInput & { readonly number: number };

/** Injected effects. Git is argv-only (`run`); PR state is adapter-owned. */
export type PublicationEffects = {
  /** argv-only git execution; rejects on nonzero exit or spawn error. */
  run: (argv: string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>;
  /** Discover the PR for this branch, or `{ kind: "missing" }` when none exists. */
  getPr: (repo: RepositoryIdentity, branch: string) => Promise<PrState>;
  createPr: (input: CreatePrInput) => Promise<{ number: number }>;
  updatePr: (input: UpdatePrInput) => Promise<{ number: number }>;
};

export type PublicationDriverOptions = {
  readonly maxAttempts?: number;
  readonly cwd?: string;
};

export const DEFAULT_MAX_PUBLICATION_ATTEMPTS = 3;

export type PublicationEvent =
  | { readonly kind: "discover"; readonly branch: BranchState; readonly pr: PrState }
  | { readonly kind: "push"; readonly argv: string[]; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "create-pr"; readonly number: number }
  | { readonly kind: "update-pr"; readonly number: number }
  | { readonly kind: "done"; readonly prNumber: number | null }
  | { readonly kind: "reject"; readonly reason: string };

export type PublicationResult =
  | {
      readonly status: "published";
      readonly prNumber: number | null;
      readonly retries: number;
      readonly events: readonly PublicationEvent[];
    }
  | {
      readonly status: "failed";
      readonly error: string;
      readonly retryable: boolean;
      readonly retries: number;
      readonly events: readonly PublicationEvent[];
    };

/** Error carrying the retry decision; `retryable: false` fails immediately. */
export class PublicationError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "PublicationError";
    this.retryable = retryable;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when two discovered snapshots are observably identical. */
function sameDiscoveredState(a: DiscoveredState, b: DiscoveredState): boolean {
  if (a.branch.kind !== b.branch.kind) return false;
  if (a.branch.kind === "exists" && b.branch.kind === "exists" && a.branch.headSha !== b.branch.headSha) {
    return false;
  }
  if (a.pr.kind !== b.pr.kind) return false;
  if (a.pr.kind === "exists" && b.pr.kind === "exists") {
    return (
      a.pr.number === b.pr.number &&
      a.pr.headSha === b.pr.headSha &&
      a.pr.base === b.pr.base &&
      a.pr.title === b.pr.title &&
      a.pr.body === b.pr.body
    );
  }
  return true;
}

/** Re-discover remote branch + PR state through the injected effects. */
async function discover(
  effects: PublicationEffects,
  plan: PublicationPlan,
  cwd: string | undefined,
): Promise<DiscoveredState> {
  const ls = await effects.run(lsRemoteArgv(plan.remote, plan.branch), { cwd });
  const branch = parseLsRemote(ls.stdout, plan.branch);
  const pr = await effects.getPr(plan.repo, plan.branch);
  return { branch, pr };
}

/**
 * Pre-push guard: the local workspace must still be at the verified head SHA
 * and clean, even when the operator's evidence is stale. Fails permanently.
 */
async function guardLocalHead(
  effects: PublicationEffects,
  plan: PublicationPlan,
  cwd: string | undefined,
): Promise<void> {
  const rev = await effects.run(revParseArgv(), { cwd });
  const head = rev.stdout.trim();
  if (head !== plan.headSha) {
    throw new PublicationError(
      `local HEAD is ${head || "(empty)"}, not the verified head ${plan.headSha}; refusing to push`,
      false,
    );
  }
  const status = await effects.run(statusArgv(), { cwd });
  if (status.stdout.trim() !== "") {
    throw new PublicationError("workspace is dirty at push time; refusing to publish", false);
  }
}

/**
 * Drive a validated plan to publication. Re-discovers remote state before
 * every mutation, fails closed on divergence, and retries transient effect
 * failures up to `maxAttempts` (each retry re-discovers first, so a partially
 * applied push is detected and never re-applied).
 */
export async function runPublication(
  plan: PublicationPlan,
  effects: PublicationEffects,
  options: PublicationDriverOptions = {},
): Promise<PublicationResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_PUBLICATION_ATTEMPTS;
  const cwd = options.cwd;
  const events: PublicationEvent[] = [];
  let lastApplied: { kind: "push" | "create-pr" | "update-pr"; state: DiscoveredState } | null = null;
  let retries = 0;
  let lastError: string | null = null;
  let lastRetryable = true;

  while (true) {
    let discovered: DiscoveredState;
    try {
      discovered = await discover(effects, plan, cwd);
    } catch (err) {
      lastError = messageOf(err);
      lastRetryable = true;
      retries += 1;
      if (retries >= maxAttempts) {
        return { status: "failed", error: lastError, retryable: true, retries, events };
      }
      continue;
    }
    events.push({ kind: "discover", branch: discovered.branch, pr: discovered.pr });

    const decision = decidePublicationStep(plan, discovered);

    if (decision.kind === "reject") {
      events.push({ kind: "reject", reason: decision.reason });
      return { status: "failed", error: decision.reason, retryable: false, retries, events };
    }
    if (decision.kind === "done") {
      events.push({ kind: "done", prNumber: decision.prNumber });
      return { status: "published", prNumber: decision.prNumber, retries, events };
    }

    // Duplicate-effect guard: never apply the same mutation twice with no
    // observable state change (e.g. a push that "succeeded" but discovery
    // still reports the branch missing). Fails closed.
    if (
      lastApplied &&
      lastApplied.kind === decision.kind &&
      sameDiscoveredState(lastApplied.state, discovered)
    ) {
      const error = `duplicate ${decision.kind} effect with no observable state change; failing closed`;
      events.push({ kind: "reject", reason: error });
      return { status: "failed", error, retryable: false, retries, events };
    }

    try {
      if (decision.kind === "push") {
        await guardLocalHead(effects, plan, cwd);
        const argv = pushArgv(plan.remote, plan.branch, plan.headSha);
        const out = await effects.run(argv, { cwd });
        events.push({ kind: "push", argv, stdout: out.stdout, stderr: out.stderr });
        lastApplied = { kind: "push", state: discovered };
      } else if (decision.kind === "create-pr") {
        const created = await effects.createPr({
          repo: plan.repo,
          branch: plan.branch,
          base: plan.base,
          title: plan.title,
          body: plan.body,
          headSha: plan.headSha,
        });
        events.push({ kind: "create-pr", number: created.number });
        lastApplied = { kind: "create-pr", state: discovered };
      } else if (decision.kind === "update-pr") {
        const updated = await effects.updatePr({
          repo: plan.repo,
          number: decision.number,
          branch: plan.branch,
          base: plan.base,
          title: plan.title,
          body: plan.body,
          headSha: plan.headSha,
        });
        events.push({ kind: "update-pr", number: updated.number });
        lastApplied = { kind: "update-pr", state: discovered };
      }
    } catch (err) {
      lastError = messageOf(err);
      lastRetryable = err instanceof PublicationError ? err.retryable : true;
      retries += 1;
      if (!lastRetryable || retries >= maxAttempts) {
        return { status: "failed", error: lastError, retryable: lastRetryable, retries, events };
      }
      continue;
    }
  }
}

// ---------------------------------------------------------------------------
// Combined entry point
// ---------------------------------------------------------------------------

export type PublishOutcome =
  | { readonly ok: true; readonly result: PublicationResult }
  | { readonly ok: false; readonly rejection: PublicationRejection };

/**
 * Validate and drive a publication in one call: plan first, then run. Rejections
 * never reach the driver; the driver only ever sees a validated, frozen plan.
 */
export async function publish(
  input: PublicationInput,
  effects: PublicationEffects,
  options: PublicationDriverOptions = {},
): Promise<PublishOutcome> {
  const plan = planPublication(input);
  if (!plan.ok) return { ok: false, rejection: plan };
  return { ok: true, result: await runPublication(plan, effects, options) };
}
