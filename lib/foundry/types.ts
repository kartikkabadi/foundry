export const STAGES = [
  "intake",
  "research",
  "grill",
  "spec",
  "improve",
  "plan_pack",
  "council",
  "architecture",
  "execute",
  "evidence",
  "merge",
  "hygiene",
] as const;

export type StageId = (typeof STAGES)[number];

export type IssueSize = "xs" | "s" | "m" | "l" | "forced_l";

export type StageStatus = "pending" | "active" | "blocked" | "skipped" | "done";

export type GateKind = "grill" | "plan" | "phase" | "evidence";

export type CycleStatus = "planned" | "active" | "closed";

export type JobStatus = "running" | "failed" | "stale";

export const STALE_JOB_MS = 8 * 60 * 1000;

export const ARTIFACT_KIND = {
  research: "research_brief",
  spec: "spec_doc",
  improve: "improve_doc",
  plan_pack: "plan_pack",
  council: "council_doc",
  architecture: "architecture_doc",
  execute: "execute_log",
  evidence: "evidence_doc",
  merge: "merge_doc",
  hygiene: "hygiene_doc",
  grillSummary: "grill_summary",
} as const;

export type ArtifactKind = (typeof ARTIFACT_KIND)[keyof typeof ARTIFACT_KIND];

export type Project = {
  id: string;
  name: string;
  targetUrl: string;
  createdAt: string;
};

export type Cycle = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: CycleStatus;
  createdAt: string;
};

export type Module = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
};

export type Issue = {
  id: string;
  idea: string;
  targetUrl: string;
  size: IssueSize;
  currentStage: StageId;
  projectId: string | null;
  cycleId: string | null;
  moduleId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IssueStage = {
  issueId: string;
  stage: StageId;
  status: StageStatus;
  skipReason: string | null;
};

export type DecisionTicket = {
  id: string;
  issueId: string;
  round: number;
  prompt: string;
  recommendation: string;
  priorMatch: string | null;
  answer: string | null;
};

export type IssueJob = {
  issueId: string;
  stage: StageId;
  status: JobStatus;
  error: string | null;
  startedAt: string;
  heartbeatAt: string;
};

export type IssueArtifact = {
  issueId: string;
  kind: string;
  stage: StageId;
  body: string;
  createdAt: string;
};

export type ResearchBrief = {
  inPlainEnglish: string;
  whatTheRepoIs: string;
  whatThisIdeaWouldChange: string;
  constraints: string[];
  risks: string[];
  questionsForYou: string[];
};

export type NavCounts = {
  issues: number;
  gates: number;
  workers: number;
  projects: number;
  cycles: number;
  modules: number;
};

export function skippedStages(size: IssueSize): Partial<Record<StageId, string>> {
  if (size === "forced_l" || size === "l") return {};
  if (size === "m") {
    return { architecture: "No structural change tagged" };
  }
  if (size === "s") {
    return {
      council: "Localized PR",
      architecture: "Localized PR",
    };
  }
  return {
    improve: "XS uses one combined plan",
    council: "XS",
    architecture: "XS",
  };
}

export function gateFor(stage: StageId): GateKind | null {
  switch (stage) {
    case "grill":
      return "grill";
    case "plan_pack":
      return "plan";
    case "execute":
      return "phase";
    case "evidence":
      return "evidence";
    case "intake":
    case "research":
    case "spec":
    case "improve":
    case "council":
    case "architecture":
    case "merge":
    case "hygiene":
      return null;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

export function artifactKindFor(stage: StageId): ArtifactKind | null {
  switch (stage) {
    case "research":
      return ARTIFACT_KIND.research;
    case "spec":
      return ARTIFACT_KIND.spec;
    case "improve":
      return ARTIFACT_KIND.improve;
    case "plan_pack":
      return ARTIFACT_KIND.plan_pack;
    case "council":
      return ARTIFACT_KIND.council;
    case "architecture":
      return ARTIFACT_KIND.architecture;
    case "execute":
      return ARTIFACT_KIND.execute;
    case "evidence":
      return ARTIFACT_KIND.evidence;
    case "merge":
      return ARTIFACT_KIND.merge;
    case "hygiene":
      return ARTIFACT_KIND.hygiene;
    case "intake":
    case "grill":
      return null;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}
