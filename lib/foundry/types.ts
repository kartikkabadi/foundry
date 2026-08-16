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

export type Issue = {
  id: string;
  idea: string;
  targetUrl: string;
  size: IssueSize;
  currentStage: StageId;
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
