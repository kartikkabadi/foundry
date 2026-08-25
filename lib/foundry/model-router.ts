// Model routing policy for the multi-agent engineering system.
// Pure: maps work kinds to OMP catalog models with capability checks, a free
// text default (DeepSeek v4 Flash), and paid fallback only under explicit
// per-run and per-task ceilings. Execution stays behind adapters.

import {
  DEFAULT_COST_CEILING_USD,
  DEFAULT_TEXT_MODEL,
  type ModelCapability,
  type ModelRequirement,
  type ModelRoute,
} from "./orchestration-types";

export const WORK_KINDS = [
  "research",
  "design",
  "code",
  "test",
  "review",
  "vision",
  "video",
  "learning",
] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

export type RoutePayload = {
  /** Payload includes image analysis (route to vision-capable models). */
  images?: boolean;
  /** Payload includes video analysis (route to vision + video-capable models). */
  video?: boolean;
};

export type OmpCatalogModel = {
  id: string;
  /** OMP role the model runs under. */
  role: string;
  capabilities: ModelCapability[];
  /** Current OMP catalog flag: images accepted (images=yes). */
  images: boolean;
  /** Current OMP catalog flag: video accepted. */
  video: boolean;
  /** Calling this model can incur cost; gated by explicit ceilings. */
  paid: boolean;
  costPerRunUsd: number;
};

export type RouterBudget = {
  perRunUsd: number;
  perTaskUsd: number;
  runSpentUsd: number;
  taskSpentUsd: number;
};

export type RouteOptions = {
  /** Explicit per-run opt-in to paid fallback. */
  allowPaidFallback: boolean;
  budget: RouterBudget;
};

export type RouteError =
  | { code: "no_capable_model"; message: string }
  | { code: "paid_not_allowed"; message: string }
  | { code: "budget_exhausted"; message: string };

export type RouteDecision =
  | {
      ok: true;
      route: ModelRoute;
      role: string;
      model: OmpCatalogModel;
      reason: string;
    }
  | { ok: false; error: RouteError };

export type RequiredCapability = {
  capability: ModelCapability;
  images: boolean;
  video: boolean;
};

// Safe fallback catalog. It only guarantees the free text default; the live
// OMP catalog (supplied by the runner adapter) is the source of truth for
// vision and video models.
export const DEFAULT_OMP_CATALOG: OmpCatalogModel[] = [
  {
    id: DEFAULT_TEXT_MODEL,
    role: "text",
    capabilities: ["text"],
    images: false,
    video: false,
    paid: false,
    costPerRunUsd: 0,
  },
];

export function requiredCapability(kind: WorkKind, payload: RoutePayload = {}): RequiredCapability {
  const images = Boolean(payload.images);
  const video = Boolean(payload.video);
  switch (kind) {
    case "vision":
      return { capability: "vision", images: true, video: false };
    case "video":
      return { capability: "vision", images: true, video: true };
    default:
      // Image or video payloads upgrade text kinds to vision-capable routing.
      if (video) return { capability: "vision", images: true, video: true };
      if (images) return { capability: "vision", images: true, video: false };
      return { capability: "text", images: false, video: false };
  }
}

export function modelMeets(model: OmpCatalogModel, requirement: RequiredCapability): boolean {
  if (!model.capabilities.includes(requirement.capability)) return false;
  if (requirement.capability !== "vision") return true;
  if (requirement.images && !model.images) return false;
  if (requirement.video && !model.video) return false;
  return true;
}

/** True when adding extraCostUsd would exceed the per-run or per-task ceiling. */
export function budgetExhausted(budget: RouterBudget, extraCostUsd: number): boolean {
  return (
    budget.taskSpentUsd + extraCostUsd > budget.perTaskUsd ||
    budget.runSpentUsd + extraCostUsd > budget.perRunUsd
  );
}

export function defaultBudget(): RouterBudget {
  return {
    perRunUsd: DEFAULT_COST_CEILING_USD,
    perTaskUsd: DEFAULT_COST_CEILING_USD,
    runSpentUsd: 0,
    taskSpentUsd: 0,
  };
}

function ceilingsExplicit(budget: RouterBudget): boolean {
  return (
    Number.isFinite(budget.perRunUsd) &&
    budget.perRunUsd > 0 &&
    Number.isFinite(budget.perTaskUsd) &&
    budget.perTaskUsd > 0
  );
}

function cheapestModel(models: OmpCatalogModel[]): OmpCatalogModel {
  return [...models].sort((left, right) => left.costPerRunUsd - right.costPerRunUsd)[0];
}

function paidFallbackChoice(
  capable: OmpCatalogModel[],
  options?: RouteOptions,
): { id: string; ceilingUsd: number } | null {
  if (!options?.allowPaidFallback) return null;
  if (!ceilingsExplicit(options.budget)) return null;
  const paid = capable.filter((model) => model.paid);
  if (paid.length === 0) return null;
  const candidate = cheapestModel(paid);
  if (budgetExhausted(options.budget, candidate.costPerRunUsd)) return null;
  return { id: candidate.id, ceilingUsd: options.budget.perTaskUsd };
}

// Continual learning: output is always a proposed lesson artifact. Nothing
// here promotes it; promotion requires evidence and an approved review.
export const LEARNING_ARTIFACT_KIND = "proposed_lesson";

function learningNote(kind: WorkKind): string {
  if (kind !== "learning") return "";
  return `; output must be a ${LEARNING_ARTIFACT_KIND} requiring evidence and review before promotion`;
}

export function route(
  kind: WorkKind,
  payload: RoutePayload = {},
  catalog: OmpCatalogModel[] = DEFAULT_OMP_CATALOG,
  options?: RouteOptions,
): RouteDecision {
  const requirement = requiredCapability(kind, payload);
  const capable = catalog.filter((model) => modelMeets(model, requirement));

  if (capable.length === 0) {
    const label = requirement.capability === "vision"
      ? requirement.video
        ? "text + vision + video"
        : "text + vision"
      : "text";
    return {
      ok: false,
      error: {
        code: "no_capable_model",
        message: `No catalog model can handle ${kind} work (requires ${label})`,
      },
    };
  }

  const free = capable.filter((model) => !model.paid);
  if (free.length > 0) {
    const primary =
      requirement.capability === "text"
        ? free.find((model) => model.id === DEFAULT_TEXT_MODEL) ?? free[0]
        : free[0];
    const modelRoute: ModelRoute = {
      primary: primary.id,
      paidFallback: null,
      paidCostCeilingUsd: null,
    };
    let reason = `Routed ${kind} to ${primary.id} (${primary.role})`;
    const fallback = paidFallbackChoice(capable, options);
    if (fallback) {
      modelRoute.paidFallback = fallback.id;
      modelRoute.paidCostCeilingUsd = fallback.ceilingUsd;
      reason += `, paid fallback ${fallback.id} under ceiling ${fallback.ceilingUsd} USD`;
    }
    reason += learningNote(kind);
    return { ok: true, route: modelRoute, role: primary.role, model: primary, reason };
  }

  // Only paid models are capable of this work.
  const cheapest = cheapestModel(capable);
  if (!options?.allowPaidFallback) {
    return {
      ok: false,
      error: {
        code: "paid_not_allowed",
        message: `${cheapest.id} is paid; paid fallback is not explicitly allowed`,
      },
    };
  }
  if (!ceilingsExplicit(options.budget)) {
    return {
      ok: false,
      error: {
        code: "paid_not_allowed",
        message: "Paid fallback requires explicit per-run and per-task cost ceilings",
      },
    };
  }
  if (budgetExhausted(options.budget, cheapest.costPerRunUsd)) {
    return {
      ok: false,
      error: {
        code: "budget_exhausted",
        message: `Budget cannot cover ${cheapest.id} (${cheapest.costPerRunUsd} USD)`,
      },
    };
  }
  return {
    ok: true,
    route: {
      primary: cheapest.id,
      paidFallback: null,
      paidCostCeilingUsd: options.budget.perTaskUsd,
    },
    role: cheapest.role,
    model: cheapest,
    reason: `Routed ${kind} to paid ${cheapest.id} under per-task ceiling ${options.budget.perTaskUsd} USD${learningNote(kind)}`,
  };
}

/** Maps a decision back to the shared ModelRequirement for an orchestration task. */
export function modelRequirementFor(decision: RouteDecision): ModelRequirement | null {
  if (!decision.ok) return null;
  return {
    capability: decision.model.capabilities.includes("vision") ? "vision" : "text",
    costCeilingUsd: decision.route.paidCostCeilingUsd,
  };
}

export type LessonEvidence = {
  ref: string;
  note: string;
};

export type LessonReview = {
  reviewer: string;
  verdict: "approved" | "rejected";
  note?: string;
};

export type ProposedLesson = {
  title: string;
  lesson: string;
  sourceTaskId: string;
  evidence: LessonEvidence | null;
  review: LessonReview | null;
};

export type LessonPromotionDecision =
  | { ok: true; lesson: ProposedLesson }
  | { ok: false; reason: string };

export function promoteLesson(lesson: ProposedLesson): LessonPromotionDecision {
  if (!lesson.title || !lesson.lesson || !lesson.sourceTaskId) {
    return { ok: false, reason: "Not a proposed lesson artifact" };
  }
  if (!lesson.evidence) {
    return { ok: false, reason: "Lesson lacks supporting evidence" };
  }
  if (!lesson.review || lesson.review.verdict !== "approved") {
    return { ok: false, reason: "Lesson lacks an approved review" };
  }
  return { ok: true, lesson };
}
