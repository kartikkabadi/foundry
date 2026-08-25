import { describe, expect, it } from "vitest";
import {
  budgetExhausted,
  DEFAULT_OMP_CATALOG,
  defaultBudget,
  LEARNING_ARTIFACT_KIND,
  modelRequirementFor,
  promoteLesson,
  route,
  type OmpCatalogModel,
  type ProposedLesson,
} from "../lib/foundry/model-router";

const DEEPSEEK: OmpCatalogModel = {
  id: "omp/deepseek-v4-flash",
  role: "text",
  capabilities: ["text"],
  images: false,
  video: false,
  paid: false,
  costPerRunUsd: 0,
};

const VISION_FREE: OmpCatalogModel = {
  id: "omp/vision-free",
  role: "vision",
  capabilities: ["text", "vision"],
  images: true,
  video: false,
  paid: false,
  costPerRunUsd: 0,
};

const VISION_VIDEO: OmpCatalogModel = {
  id: "omp/vision-video",
  role: "vision",
  capabilities: ["text", "vision"],
  images: true,
  video: true,
  paid: false,
  costPerRunUsd: 0,
};

const VISION_PAID: OmpCatalogModel = {
  id: "omp/vision-paid",
  role: "vision",
  capabilities: ["text", "vision"],
  images: true,
  video: false,
  paid: true,
  costPerRunUsd: 0.08,
};

const VISION_IMAGES_NO: OmpCatalogModel = {
  id: "omp/vision-no-images",
  role: "vision",
  capabilities: ["text", "vision"],
  images: false,
  video: false,
  paid: false,
  costPerRunUsd: 0,
};

describe("text default", () => {
  it("routes text kinds to DeepSeek v4 Flash by default", () => {
    for (const kind of ["research", "design", "code", "test", "review", "learning"] as const) {
      const decision = route(kind);
      expect(decision.ok).toBe(true);
      if (decision.ok) {
        expect(decision.route.primary).toBe("omp/deepseek-v4-flash");
        expect(decision.role).toBe("text");
      }
    }
  });

  it("keeps the free text default even when a paid model is capable", () => {
    const decision = route("research", {}, [VISION_PAID, DEEPSEEK]);
    expect(decision.ok && decision.route.primary).toBe("omp/deepseek-v4-flash");
  });
});

describe("image and video capability checks", () => {
  it("refuses vision work when no model accepts images", () => {
    const decision = route("vision", {}, DEFAULT_OMP_CATALOG);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error.code).toBe("no_capable_model");
  });

  it("refuses image payloads on text kinds when only images=no models exist", () => {
    const decision = route("research", { images: true }, [DEEPSEEK]);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error.code).toBe("no_capable_model");
  });

  it("does not route vision to a model whose catalog says images=no", () => {
    const decision = route("vision", {}, [DEEPSEEK, VISION_IMAGES_NO]);
    expect(decision.ok).toBe(false);
  });

  it("routes image work to a vision-capable model", () => {
    const decision = route("vision", {}, [DEEPSEEK, VISION_FREE]);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.route.primary).toBe("omp/vision-free");
      expect(decision.role).toBe("vision");
    }
  });

  it("routes image payloads inside text kinds to a vision-capable model", () => {
    const decision = route("design", { images: true }, [DEEPSEEK, VISION_FREE]);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.route.primary).toBe("omp/vision-free");
  });

  it("refuses video work without a video-capable model", () => {
    const decision = route("video", {}, [DEEPSEEK, VISION_FREE]);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error.code).toBe("no_capable_model");
  });

  it("routes video work to a video-capable model", () => {
    const decision = route("video", {}, [DEEPSEEK, VISION_FREE, VISION_VIDEO]);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.route.primary).toBe("omp/vision-video");
  });
});

describe("paid fallback", () => {
  it("refuses paid routing when fallback is not explicitly allowed", () => {
    const decision = route("vision", {}, [DEEPSEEK, VISION_PAID], {
      allowPaidFallback: false,
      budget: defaultBudget(),
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error.code).toBe("paid_not_allowed");
  });

  it("refuses paid fallback without explicit ceilings", () => {
    const budget = { perRunUsd: 0, perTaskUsd: 0, runSpentUsd: 0, taskSpentUsd: 0 };
    const decision = route("vision", {}, [DEEPSEEK, VISION_PAID], { allowPaidFallback: true, budget });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error.code).toBe("paid_not_allowed");
  });

  it("routes to a paid model only under explicit ceilings within budget", () => {
    const budget = { perRunUsd: 1, perTaskUsd: 0.5, runSpentUsd: 0, taskSpentUsd: 0 };
    const decision = route("vision", {}, [DEEPSEEK, VISION_PAID], { allowPaidFallback: true, budget });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.route.primary).toBe("omp/vision-paid");
      expect(decision.route.paidCostCeilingUsd).toBe(0.5);
    }
  });

  it("attaches a paid fallback under ceilings when a free primary exists", () => {
    const budget = { perRunUsd: 1, perTaskUsd: 0.5, runSpentUsd: 0, taskSpentUsd: 0 };
    const decision = route("vision", {}, [DEEPSEEK, VISION_FREE, VISION_PAID], {
      allowPaidFallback: true,
      budget,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.route.primary).toBe("omp/vision-free");
      expect(decision.route.paidFallback).toBe("omp/vision-paid");
      expect(decision.route.paidCostCeilingUsd).toBe(0.5);
    }
  });
});

describe("budget exhaustion", () => {
  it("refuses paid routing when the budget is exhausted", () => {
    const budget = { perRunUsd: 0.05, perTaskUsd: 0.05, runSpentUsd: 0, taskSpentUsd: 0 };
    const decision = route("vision", {}, [DEEPSEEK, VISION_PAID], { allowPaidFallback: true, budget });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error.code).toBe("budget_exhausted");
  });

  it("budgetExhausted respects the per-task ceiling", () => {
    const budget = { perRunUsd: 1, perTaskUsd: 0.2, runSpentUsd: 0.1, taskSpentUsd: 0.15 };
    expect(budgetExhausted(budget, 0.1)).toBe(true);
  });

  it("budgetExhausted respects the per-run ceiling", () => {
    const budget = { perRunUsd: 0.3, perTaskUsd: 1, runSpentUsd: 0.25, taskSpentUsd: 0 };
    expect(budgetExhausted(budget, 0.1)).toBe(true);
  });

  it("budgetExhausted allows a cost that fits both ceilings", () => {
    const budget = { perRunUsd: 1, perTaskUsd: 0.2, runSpentUsd: 0.1, taskSpentUsd: 0.05 };
    expect(budgetExhausted(budget, 0.1)).toBe(false);
  });
});

describe("model requirement mapping", () => {
  it("maps a free text route to a text ModelRequirement without a ceiling", () => {
    const decision = route("research");
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      const requirement = modelRequirementFor(decision);
      expect(requirement?.capability).toBe("text");
      expect(requirement?.costCeilingUsd).toBeNull();
    }
  });

  it("carries the paid ceiling into the ModelRequirement", () => {
    const budget = { perRunUsd: 1, perTaskUsd: 0.5, runSpentUsd: 0, taskSpentUsd: 0 };
    const decision = route("vision", {}, [DEEPSEEK, VISION_PAID], { allowPaidFallback: true, budget });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(modelRequirementFor(decision)?.costCeilingUsd).toBe(0.5);
    }
  });
});

describe("lesson promotion guard", () => {
  it("keeps learning output as a proposed lesson artifact", () => {
    expect(LEARNING_ARTIFACT_KIND).toBe("proposed_lesson");
  });

  it("refuses promotion without evidence", () => {
    const lesson: ProposedLesson = {
      title: "Title",
      lesson: "Lesson",
      sourceTaskId: "task-1",
      evidence: null,
      review: null,
    };
    const decision = promoteLesson(lesson);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toMatch(/evidence/i);
  });

  it("refuses promotion without an approved review", () => {
    const lesson: ProposedLesson = {
      title: "Title",
      lesson: "Lesson",
      sourceTaskId: "task-1",
      evidence: { ref: "run-1", note: "observed" },
      review: null,
    };
    const decision = promoteLesson(lesson);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toMatch(/review/i);
  });

  it("refuses promotion when the review is rejected", () => {
    const lesson: ProposedLesson = {
      title: "Title",
      lesson: "Lesson",
      sourceTaskId: "task-1",
      evidence: { ref: "run-1", note: "observed" },
      review: { reviewer: "reviewer", verdict: "rejected" },
    };
    expect(promoteLesson(lesson).ok).toBe(false);
  });

  it("promotes only with evidence and an approved review", () => {
    const lesson: ProposedLesson = {
      title: "Title",
      lesson: "Lesson",
      sourceTaskId: "task-1",
      evidence: { ref: "run-1", note: "observed" },
      review: { reviewer: "reviewer", verdict: "approved", note: "ok" },
    };
    expect(promoteLesson(lesson).ok).toBe(true);
  });

  it("refuses an empty artifact", () => {
    const lesson: ProposedLesson = {
      title: "",
      lesson: "",
      sourceTaskId: "",
      evidence: null,
      review: null,
    };
    expect(promoteLesson(lesson).ok).toBe(false);
  });
});
