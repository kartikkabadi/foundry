// Automated-approval policy for the continual-learning system.
// Pure policy: decides whether a harvested lesson may be approved without a
// separate human reviewer. Approval authority is an explicit typed risk
// classification issued by an approved independent verifier — never prose
// heuristics. Evidence is resolved through an injected authoritative lookup,
// never author-controlled ref strings. The approved output is an opaque
// policy-decision record bound to the lesson, its evidence, and the policy
// version; promotion composition consumes that record and verifies every
// binding before it touches evaluatePromotion. Nothing is installed here.

import { createHash } from "node:crypto";
import {
  evaluatePromotion,
  relaxesPolicy,
  type LearningRecord,
  type LessonRecord,
  type LessonReview,
  type PromotionResult,
} from "./learning";

/** Default policy version for the safe default policy. */
export const DEFAULT_POLICY_VERSION = "1";

/** Default approval authority for the safe default policy. */
export const DEFAULT_AUTHORITY = "policy:approval";

/** Every lesson risk class. The union is exhaustive: a new consequence class
 *  cannot be added without a matching decision branch. Only `factual` is
 *  eligible for automated approval; every other class fails closed. */
export type LessonRiskCategory =
  | { kind: "factual" }
  | { kind: "judgment" }
  | { kind: "spending" }
  | { kind: "security" }
  | { kind: "deployment" }
  | { kind: "merge" }
  | { kind: "cleanup" }
  | { kind: "mutation" }
  | { kind: "unclassified" };

export type LessonRiskCategoryKind = LessonRiskCategory["kind"];

/** Explicit typed classification of one lesson, issued by an approved
 *  independent verifier. This — not lesson prose — is the approval authority. */
export type LessonRiskClassification = {
  category: LessonRiskCategory;
  /** Identity of the verifier that issued it; must be in the policy's
   *  approvedClassifiers and independent of the lesson author. */
  issuedBy: string;
  issuedAt: string;
  /** Binding: must match the lesson it classifies. */
  lessonId: string;
  lessonKey: string;
};

/** A typed evidence record resolved from durable evidence by an authoritative
 *  lookup. Author-controlled ref strings are only lookup keys; nothing counts
 *  as evidence unless the resolver returns a record bound to the lesson. */
export type EvidenceRecord = {
  id: string;
  kind: "verifier" | "event" | "run" | "proof";
  /** The lesson key this evidence supports; only bound records count. */
  lessonKey: string;
};

/** Synchronous authoritative evidence lookup, injected by the caller (e.g.
 *  over a pre-loaded durable evidence index). Returns the typed record for a
 *  ref, or undefined when the ref is not backed by durable evidence. */
export type EvidenceResolver = (ref: string) => EvidenceRecord | undefined;

/** Operator configuration for automated approval. Plain serializable JSON so
 *  durable wiring can persist it; UI actions never execute work. */
export type AutomatedApprovalPolicy = {
  /** Automated approval is strictly opt-in; false (the default) disables it. */
  enabled: boolean;
  /** Version of this policy; approvals are bound to it and fail on change. */
  version: string;
  /** Resolved evidence records required, bound to the lesson. Must be a
   *  positive integer so the evidence guarantee is never waived. */
  minEvidence: number;
  /** Verifier identities approved to issue risk classifications. */
  approvedClassifiers: readonly string[];
  /** Opaque approval authority (reviewer/issuer identity); must be
   *  independent of any lesson author. */
  authority: string;
};

/** Opaque approval decision record. Promotion composition consumes this and
 *  verifies every binding (digest, policy version, lesson, evidence, and
 *  authority) before promoting; a raw reviewer string is never proof. */
export type PolicyDecisionRecord = {
  /** Stable id, unique per lesson and policy version. */
  id: string;
  /** Policy version this approval is bound to. */
  policyVersion: string;
  /** Opaque approval authority (reviewer/issuer identity). */
  authority: string;
  /** Only factual/mechanical lessons can be approved. */
  category: "factual";
  /** Covered lesson. */
  lessonId: string;
  lessonKey: string;
  /** Immutable canonical lesson content captured at approval time; the digest
   *  covers these so replaying a record against a mutated lesson fails. */
  lessonPattern: string;
  lessonRetentionRule: string;
  lessonAuthor: string;
  /** Exact evidence record ids the decision was based on. */
  evidenceIds: readonly string[];
  decision: "approved";
  /** SHA-256 digest over the stable binding fields. */
  digest: string;
};

export type AutomatedApprovalDecision =
  | {
      kind: "approved";
      /** Opaque, bound decision record. */
      record: PolicyDecisionRecord;
      /** Synthesized independent review for evaluatePromotion. */
      review: LessonReview;
    }
  | {
      kind: "rejected";
      /** The lesson's risk class; `unclassified` when no class was proven. */
      category: LessonRiskCategory;
      reason: string;
    };

/** Safe default: automated approval is off, one bound evidence record is
 *  required, no verifiers are approved, and the authority is a stable opaque
 *  identity. */
export function defaultApprovalPolicy(
  overrides: Partial<AutomatedApprovalPolicy> = {},
): AutomatedApprovalPolicy {
  return {
    enabled: false,
    version: DEFAULT_POLICY_VERSION,
    minEvidence: 1,
    approvedClassifiers: [],
    authority: DEFAULT_AUTHORITY,
    ...overrides,
  };
}

export type PolicyShapeCheck = { ok: true } | { ok: false; reason: string };

/** Shared policy-validity check used by both the fresh decision path and the
 *  replay path, so version/authority/minEvidence/approved-verifier invariants
 *  cannot drift between them. Fails closed: a policy that is disabled, waives
 *  the evidence minimum, has no authority, approves no verifiers, or has no
 *  version is invalid for automated approval. */
function validatePolicy(policy: AutomatedApprovalPolicy): PolicyShapeCheck {
  if (policy.enabled !== true) {
    return { ok: false, reason: "Automated approval is disabled by operator policy" };
  }
  const minEvidence = policy.minEvidence;
  if (!Number.isInteger(minEvidence) || minEvidence < 1) {
    return {
      ok: false,
      reason: "Automated approval policy must require at least one resolved evidence record",
    };
  }
  const authority = (policy.authority ?? "").trim();
  if (!authority) {
    return { ok: false, reason: "Automated approval policy has no authority identity" };
  }
  // Durable policy values must be canonical: a padded authority would pass the
  // non-blank check here but break exact equality against the record's trimmed
  // authority in verifyPolicyDecision. Reject it so fresh and replay agree.
  if (policy.authority !== authority) {
    return { ok: false, reason: "Automated approval policy authority must be canonical (no surrounding whitespace)" };
  }
  const approvedClassifiers = (policy.approvedClassifiers ?? [])
    .map((identity) => identity.trim())
    .filter((identity) => identity.length > 0);
  if (approvedClassifiers.length === 0) {
    return { ok: false, reason: "Automated approval policy approves no classification verifiers" };
  }
  if (!policy.version || !policy.version.trim()) {
    return { ok: false, reason: "Automated approval policy has no version" };
  }
  return { ok: true };
}

/** Marker phrases that mean a rule needs human judgment to apply. */
const JUDGMENT_MARKERS = [
  "judgment",
  "judgement",
  "human judgment",
  "use your discretion",
  "weigh the",
  "trade-off",
  "tradeoff",
  "decide whether",
  "decide if",
  "it depends",
  "subjective",
  "professional opinion",
] as const;

/** Marker phrases that mean a rule spends money or touches a budget. */
const SPENDING_MARKERS = [
  "spend",
  "spending",
  "payment",
  "payments",
  "pay for",
  "paid",
  "increase the budget",
  "raise the budget",
  "budget",
  "purchase",
  "buy",
  "billing",
  "invoice",
  "subscription",
  "cost ceiling",
  "costs money",
  "cost money",
] as const;

/** Marker phrases that mean a rule changes security posture or grants
 *  privileged/admin access. */
const SECURITY_MARKERS = [
  "security",
  "credential",
  "secret",
  "password",
  "passphrase",
  "access token",
  "auth token",
  "api key",
  "api-key",
  "permission",
  "privilege",
  "privilege escalation",
  "access control",
  "authorization",
  "authentication",
  "encryption",
  "cipher",
  "vulnerability",
  "exploit",
  "sandbox escape",
  "certificate",
  "pki",
  "admin access",
  "grant admin",
  "admin credentials",
  "admin password",
  "administrator",
  "admin action",
  "admin task",
] as const;

/** Marker phrases that mean a rule performs a deployment or outward publish.
 *  Phrase-level so a mechanical gate that merely mentions a deploy context
 *  ("test before deploying") stays out of this class. */
const DEPLOYMENT_MARKERS = [
  "deploy to",
  "deploy the",
  "deploy this",
  "deploy it",
  "deploy on",
  "deploy after",
  "deploy when",
  "deploy without",
  "deploying the",
  "release to production",
  "production release",
  "production deployment",
  "rollout",
  "roll out",
  "ship to production",
  "go live",
  "push to",
  "push to remote",
  "push to origin",
  "push the branch",
  "push the changes",
  "push this",
  "push it",
  "git push",
  "publish to",
  "publish the",
] as const;

/** Marker phrases that mean a rule performs a merge. Phrase-level so a
 *  mechanical gate that merely mentions a merge context ("tests before
 *  merge") stays out of this class. */
const MERGE_MARKERS = [
  "merge the",
  "merge this",
  "merge it",
  "merge into",
  "merge pr",
  "merge the pull request",
  "merge the pr",
  "merge the branch",
  "merge branch",
  "merge after",
  "merge when",
  "merge without",
  "merge on",
  "auto-merge",
  "automatically merge",
  "automerge",
  "auto merge",
  "squash and merge",
  "rebase and merge",
  "merge and close",
] as const;

/** Marker phrases that mean a rule deletes or cleans up state. */
const CLEANUP_MARKERS = [
  "delete the",
  "delete this",
  "delete it",
  "delete files",
  "delete old",
  "delete the old",
  "delete the migration",
  "delete the branch",
  "delete the file",
  "remove the",
  "remove this",
  "remove it",
  "remove files",
  "remove the old",
  "remove the migration",
  "remove the dead",
  "remove the duplicate",
  "remove the file",
  "clean up the",
  "cleanup the",
  "tidy up",
  "prune the",
  "garbage collect",
  "rm -rf",
  "rm -r",
] as const;

/** Marker phrases that mean a rule mutates a prompt, skill, source, policy,
 *  gate, or the agent itself. Installing a lint rule, check, or gate is a
 *  mechanical change and is intentionally not listed here. */
const MUTATION_MARKERS = [
  "modify the prompt",
  "edit the prompt",
  "change the prompt",
  "update the prompt",
  "rewrite the prompt",
  "alter the prompt",
  "adjust the prompt",
  "tune the prompt",
  "write a prompt",
  "write the prompt",
  "install a prompt",
  "add a prompt",
  "new prompt",
  "system prompt",
  "modify the skill",
  "edit the skill",
  "change the skill",
  "update the skill",
  "rewrite the skill",
  "alter the skill",
  "write a skill",
  "install a skill",
  "add a skill",
  "new skill",
  "create a skill",
  "modify the source",
  "edit the source",
  "change the source",
  "update the source",
  "rewrite the source",
  "alter the source",
  "modify policy",
  "edit policy",
  "change policy",
  "update policy",
  "rewrite policy",
  "alter policy",
  "modify the rule",
  "change the rule",
  "update the rule",
  "rewrite the rule",
  "modify the gate",
  "change the gate",
  "update the gate",
  "rewrite the gate",
  "self-modify",
  "self-modification",
  "modify itself",
  "modify its own",
  "rewrite itself",
  "rewrite its own",
  "change its own",
  "update its own",
  "edit itself",
] as const;

/** Forbidden consequence classes, checked in this fixed order. */
const CONSEQUENCE_MARKERS: readonly {
  category: Exclude<LessonRiskCategoryKind, "factual" | "unclassified">;
  markers: readonly string[];
}[] = [
  { category: "judgment", markers: JUDGMENT_MARKERS },
  { category: "spending", markers: SPENDING_MARKERS },
  { category: "security", markers: SECURITY_MARKERS },
  { category: "deployment", markers: DEPLOYMENT_MARKERS },
  { category: "merge", markers: MERGE_MARKERS },
  { category: "cleanup", markers: CLEANUP_MARKERS },
  { category: "mutation", markers: MUTATION_MARKERS },
];

/** Human phrasing for each forbidden class, used in rejection reasons. */
const FORBIDDEN_CLASS_REASON: Record<
  Exclude<LessonRiskCategoryKind, "factual" | "unclassified">,
  string
> = {
  judgment: "requires human judgment",
  spending: "involves spending or a budget change",
  security: "changes security posture or grants privileged access",
  deployment: "performs a deployment or outward publish",
  merge: "performs a merge",
  cleanup: "performs cleanup or deletion",
  mutation: "mutates a prompt, skill, source, or policy",
};

type ForbiddenConsequence = Exclude<LessonRiskCategory, { kind: "factual" } | { kind: "unclassified" }>;

/** Fail-closed backstop: forbidden action wording can only reject, never
 *  approve. Approval authority is the typed classification below; this scan
 *  exists so risky wording fails even against a forged or mislabeled typed
 *  classification. Returns the first forbidden class found, or null. */
function forbiddenWordingClass(lesson: LessonRecord): ForbiddenConsequence | null {
  const retentionRule = (lesson.retentionRule ?? "").toLowerCase();
  const pattern = (lesson.pattern ?? "").toLowerCase();
  const haystacks = [retentionRule, pattern];

  for (const entry of CONSEQUENCE_MARKERS) {
    const hit = entry.markers.some((marker) =>
      haystacks.some((haystack) => haystack.includes(marker)),
    );
    if (hit) return { kind: entry.category };
  }
  return null;
}

export type ResolvedEvidence =
  | { ok: true; records: EvidenceRecord[] }
  | { ok: false; reason: string };

/** Resolve the lesson's refs through the authoritative lookup and keep only
 *  records bound to the lesson's key, deduplicated by stable evidence id.
 *  Author-controlled ref strings carry no weight on their own: nothing counts
 *  as evidence unless the resolver returns a record bound to the lesson, and
 *  duplicate refs cannot satisfy the minimum — each distinct evidence id
 *  counts once. Two records sharing an id but disagreeing on content are a
 *  conflict and are rejected rather than silently resolved. */
function resolveBoundEvidence(
  lesson: LessonRecord,
  resolveEvidence: EvidenceResolver,
): ResolvedEvidence {
  const byId = new Map<string, EvidenceRecord>();
  for (const ref of lesson.refs) {
    const record = resolveEvidence(ref);
    if (!record || record.lessonKey !== lesson.key) continue;
    const existing = byId.get(record.id);
    if (existing) {
      if (existing.kind !== record.kind || existing.lessonKey !== record.lessonKey) {
        return {
          ok: false,
          reason: `Conflicting evidence records share id ${record.id}`,
        };
      }
      continue; // duplicate ref to the same record: counts once
    }
    byId.set(record.id, record);
  }
  return { ok: true, records: [...byId.values()] };
}

/** Canonical serialization of the stable binding fields a digest covers. */
function canonicalDecisionPayload(record: PolicyDecisionRecord): string {
  return JSON.stringify({
    id: record.id,
    policyVersion: record.policyVersion,
    authority: record.authority,
    category: record.category,
    lessonId: record.lessonId,
    lessonKey: record.lessonKey,
    lessonPattern: record.lessonPattern,
    lessonRetentionRule: record.lessonRetentionRule,
    lessonAuthor: record.lessonAuthor,
    evidenceIds: [...record.evidenceIds].sort(),
    decision: record.decision,
  });
}

/** SHA-256 digest over the record's stable binding fields. Exposed so durable
 *  wiring and verifiers can recompute and check a record's digest. */
export function decisionDigest(record: PolicyDecisionRecord): string {
  return createHash("sha256").update(canonicalDecisionPayload(record)).digest("hex");
}

export type PolicyDecisionVerification = { ok: true } | { ok: false; reason: string };

/**
 * Verify every binding of an opaque policy-decision record against the lesson,
 * the operator policy, and the authoritative evidence lookup: the digest must
 * match the record's own fields, the decision must be a factual approval bound
 * to this lesson and this policy version, the authority must be the policy's
 * and independent of the lesson author, and the evidence ids must exactly match
 * what the authoritative lookup resolves for this lesson.
 */
export function verifyPolicyDecision(
  record: PolicyDecisionRecord,
  lesson: LessonRecord,
  policy: AutomatedApprovalPolicy,
  resolveEvidence: EvidenceResolver,
): PolicyDecisionVerification {
  const policyCheck = validatePolicy(policy);
  if (!policyCheck.ok) {
    return { ok: false, reason: policyCheck.reason };
  }
  if (record.decision !== "approved" || record.category !== "factual") {
    return { ok: false, reason: "Policy decision is not a factual approval" };
  }
  if (record.digest !== decisionDigest(record)) {
    return { ok: false, reason: "Policy decision digest does not match its bindings" };
  }
  if (record.policyVersion !== policy.version) {
    return {
      ok: false,
      reason: `Policy decision version ${record.policyVersion} does not match policy version ${policy.version}`,
    };
  }
  if (record.lessonId !== lesson.id || record.lessonKey !== lesson.key) {
    return { ok: false, reason: "Policy decision is not bound to this lesson" };
  }
  if (
    record.lessonPattern !== lesson.pattern ||
    record.lessonRetentionRule !== (lesson.retentionRule ?? "") ||
    record.lessonAuthor !== (lesson.author ?? "")
  ) {
    return { ok: false, reason: "Policy decision lesson content does not match the current lesson" };
  }
  if (record.authority !== policy.authority) {
    return { ok: false, reason: "Policy decision authority does not match the policy authority" };
  }
  if (record.authority === (lesson.author ?? "").trim()) {
    return { ok: false, reason: "Policy decision authority must be independent of the lesson author" };
  }
  const resolved = resolveBoundEvidence(lesson, resolveEvidence);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  const actual = resolved.records.map((evidence) => evidence.id).sort();
  const expected = [...record.evidenceIds].sort();
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    return { ok: false, reason: "Policy decision evidence does not match resolved evidence" };
  }
  // Distinct resolved evidence must still satisfy the current policy minimum
  // even when the ids match exactly: a raised minEvidence invalidates a replay.
  if (resolved.records.length < policy.minEvidence) {
    return {
      ok: false,
      reason: `Policy decision evidence is insufficient: needs ${policy.minEvidence} resolved evidence record${policy.minEvidence === 1 ? "" : "s"} but has ${resolved.records.length}`,
    };
  }
  return { ok: true };
}

/**
 * Decide whether a harvested lesson may be approved automatically. Fails
 * closed: automated approval is off unless the operator policy enables it;
 * generic lesson prose alone is never enough — an explicit typed risk
 * classification issued by an approved verifier independent of the author is
 * required, bound to the lesson. Forbidden wording, self-review, missing
 * author, missing or unresolved evidence, policy relaxation, and duplicate
 * keys are all rejected. Pure and deterministic; the caller owns all effects.
 */
export function evaluateAutomatedApproval(
  lesson: LessonRecord,
  classification: LessonRiskClassification | null,
  policy: AutomatedApprovalPolicy,
  prior: readonly LearningRecord[] = [],
  options: { resolveEvidence?: EvidenceResolver; now?: () => string } = {},
): AutomatedApprovalDecision {
  const policyCheck = validatePolicy(policy);
  if (!policyCheck.ok) {
    return {
      kind: "rejected",
      category: { kind: "unclassified" },
      reason: policyCheck.reason,
    };
  }
  const minEvidence = policy.minEvidence;
  const authority = (policy.authority ?? "").trim();
  const approvedClassifiers = (policy.approvedClassifiers ?? [])
    .map((identity) => identity.trim())
    .filter((identity) => identity.length > 0);

  if (lesson.kind !== "lesson" || !lesson.key || lesson.refs.length === 0) {
    return {
      kind: "rejected",
      category: { kind: "unclassified" },
      reason: "Not a harvested lesson with supporting evidence",
    };
  }
  const author = (lesson.author ?? "").trim();
  if (!author) {
    return {
      kind: "rejected",
      category: { kind: "unclassified" },
      reason: "Lesson has no identifiable author",
    };
  }

  const wordingClass = forbiddenWordingClass(lesson);
  if (wordingClass) {
    return {
      kind: "rejected",
      category: wordingClass,
      reason: `Lesson wording ${FORBIDDEN_CLASS_REASON[wordingClass.kind]} and cannot be auto-approved`,
    };
  }

  if (!classification) {
    return {
      kind: "rejected",
      category: { kind: "unclassified" },
      reason: "Lesson has no typed risk classification from an approved verifier",
    };
  }
  if (classification.lessonId !== lesson.id || classification.lessonKey !== lesson.key) {
    return {
      kind: "rejected",
      category: { kind: "unclassified" },
      reason: "Risk classification is not bound to this lesson",
    };
  }
  const classifier = (classification.issuedBy ?? "").trim();
  if (!classifier) {
    return {
      kind: "rejected",
      category: { kind: "unclassified" },
      reason: "Risk classification has no issuing verifier",
    };
  }
  if (!approvedClassifiers.includes(classifier)) {
    return {
      kind: "rejected",
      category: { kind: "unclassified" },
      reason: `Risk classification issuer ${classifier} is not an approved verifier`,
    };
  }
  if (classifier === author) {
    return {
      kind: "rejected",
      category: { kind: "unclassified" },
      reason: "Risk classification must be issued by a verifier independent of the lesson author",
    };
  }
  if (classification.category.kind !== "factual") {
    return {
      kind: "rejected",
      category: classification.category,
      reason: "Risk classification is not a low-risk factual or mechanical class",
    };
  }
  if (authority === author) {
    return {
      kind: "rejected",
      category: { kind: "factual" },
      reason: "Approval authority must be independent of the lesson author",
    };
  }

  if (relaxesPolicy(lesson.retentionRule)) {
    return {
      kind: "rejected",
      category: { kind: "factual" },
      reason: "Lesson would relax a gate or budget and is rejected by default",
    };
  }
  if (prior.some((record) => record.kind === "promotion" && record.key === lesson.key)) {
    return {
      kind: "rejected",
      category: { kind: "factual" },
      reason: `Lesson key ${lesson.key} is already promoted`,
    };
  }

  if (!options.resolveEvidence) {
    return {
      kind: "rejected",
      category: { kind: "factual" },
      reason: "No evidence resolver was injected",
    };
  }
  const resolved = resolveBoundEvidence(lesson, options.resolveEvidence);
  if (!resolved.ok) {
    return {
      kind: "rejected",
      category: { kind: "factual" },
      reason: resolved.reason,
    };
  }
  if (resolved.records.length < minEvidence) {
    return {
      kind: "rejected",
      category: { kind: "factual" },
      reason: `Lesson needs ${minEvidence} resolved evidence record${minEvidence === 1 ? "" : "s"} bound to it but has ${resolved.records.length}`,
    };
  }

  const record: PolicyDecisionRecord = {
    id: `approval:${lesson.id}:${policy.version}`,
    policyVersion: policy.version,
    authority,
    category: "factual",
    lessonId: lesson.id,
    lessonKey: lesson.key,
    lessonPattern: lesson.pattern,
    lessonRetentionRule: lesson.retentionRule ?? "",
    lessonAuthor: lesson.author ?? "",
    evidenceIds: resolved.records.map((evidence) => evidence.id),
    decision: "approved",
    digest: "",
  };
  record.digest = decisionDigest(record);

  return {
    kind: "approved",
    record,
    review: { reviewer: authority, verdict: "approved" },
  };
}

/**
 * Compose the decision layer with the existing promotion gate. The decision is
 * evaluated, its record is verified against the lesson, policy, and evidence
 * lookup, and only then is the synthesized review passed to evaluatePromotion
 * with explicit operator pre-authorization — so every existing guarantee is
 * re-enforced rather than bypassed.
 */
export function approveLessonAutomatically(
  lesson: LessonRecord,
  classification: LessonRiskClassification | null,
  policy: AutomatedApprovalPolicy,
  prior: readonly LearningRecord[] = [],
  options: { resolveEvidence?: EvidenceResolver; now?: () => string } = {},
): PromotionResult {
  const decision = evaluateAutomatedApproval(lesson, classification, policy, prior, options);
  if (decision.kind !== "approved") {
    return { ok: false, reason: decision.reason };
  }
  if (!options.resolveEvidence) {
    return { ok: false, reason: "No evidence resolver was injected" };
  }
  const verified = verifyPolicyDecision(decision.record, lesson, policy, options.resolveEvidence);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  return evaluatePromotion(lesson, decision.review, prior, {
    operatorApproved: true,
    now: options.now,
  });
}

/**
 * Promote using a previously produced opaque policy-decision record (for
 * example one persisted by durable wiring). Every binding is verified before
 * the review reaches evaluatePromotion; a raw reviewer string is never proof.
 */
export function promoteWithPolicyDecision(
  lesson: LessonRecord,
  record: PolicyDecisionRecord,
  policy: AutomatedApprovalPolicy,
  prior: readonly LearningRecord[] = [],
  options: { resolveEvidence?: EvidenceResolver; now?: () => string } = {},
): PromotionResult {
  if (!options.resolveEvidence) {
    return { ok: false, reason: "No evidence resolver was injected" };
  }
  // A replay must not promote under a policy the operator has since disabled
  // or changed shape on; the same shared validity check the fresh path uses.
  const policyCheck = validatePolicy(policy);
  if (!policyCheck.ok) {
    return { ok: false, reason: policyCheck.reason };
  }
  // Rejection-only re-scan of the live lesson: a record replayed against a
  // mutated lesson must fail even before the record's own bindings are
  // checked. Only rejection is allowed here — never approval.
  const wordingClass = forbiddenWordingClass(lesson);
  if (wordingClass) {
    return {
      ok: false,
      reason: `Lesson wording ${FORBIDDEN_CLASS_REASON[wordingClass.kind]} and cannot be auto-approved`,
    };
  }
  if (relaxesPolicy(lesson.retentionRule)) {
    return { ok: false, reason: "Lesson would relax a gate or budget and is rejected by default" };
  }
  const verified = verifyPolicyDecision(record, lesson, policy, options.resolveEvidence);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  return evaluatePromotion(
    lesson,
    { reviewer: record.authority, verdict: "approved" },
    prior,
    { operatorApproved: true, now: options.now },
  );
}
