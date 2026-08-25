"use server";

import { redirect } from "next/navigation";
import {
  AutomationControlStaleVersionError,
  AutomationControlValidationError,
  type AutomationControlPatch,
} from "@/lib/foundry/automation-control";
import { saveGrillSummary, startGrill } from "@/lib/foundry/grill";
import { appendEvent } from "@/lib/foundry/log";
import { startOneshotWalk } from "@/lib/foundry/oneshot";
import { startResearch } from "@/lib/foundry/research";
import { startSpec } from "@/lib/foundry/spec";
import {
  answerDecisionTicket,
  assignIssue,
  cancelOneshot,
  clearJob,
  clearTicketAnswer,
  completeActiveStage,
  createAutomationControlStore,
  createCycle,
  createIssue,
  createModule,
  createProject,
  getIssue,
  getProject,
  isGrillHeld,
  resetJobAttempts,
  setGrillHold,
  setOneshotStopReason,
  setWalkHold,
  unansweredTicketCount,
} from "@/lib/foundry/store";
import { startExecute } from "@/lib/foundry/execute";
import { startWalkStage } from "@/lib/foundry/walk";
import { parseRunMode, type Issue, type IssueSize, type StageId } from "@/lib/foundry/types";

const SIZES: IssueSize[] = ["xs", "s", "m", "l", "forced_l"];

function requireIssue(id: string) {
  const loaded = getIssue(id);
  if (!id || !loaded) throw new Error("issue not found");
  return loaded;
}

function kickOneshot(issue: Issue): void {
  if (issue.runMode !== "oneshot" || issue.walkHold) return;
  startOneshotWalk(issue.id);
}

export async function createIssueAction(formData: FormData) {
  const idea = String(formData.get("idea") ?? "").trim();
  const targetUrl = String(formData.get("targetUrl") ?? "").trim();
  const sizeRaw = String(formData.get("size") ?? "s");
  const size = SIZES.includes(sizeRaw as IssueSize) ? (sizeRaw as IssueSize) : "s";
  const runMode = parseRunMode(String(formData.get("runMode") ?? "hitl"));
  const projectId = String(formData.get("projectId") ?? "").trim() || null;
  const cycleId = String(formData.get("cycleId") ?? "").trim() || null;
  const moduleId = String(formData.get("moduleId") ?? "").trim() || null;
  if (!idea || !targetUrl) {
    throw new Error("idea and targetUrl are required");
  }
  const issue = createIssue({
    idea,
    targetUrl,
    size,
    runMode,
    projectId,
    cycleId,
    moduleId,
  });
  startResearch(issue.id);
  kickOneshot(issue);
  redirect(`/issues/${issue.id}`);
}

export async function retryResearchAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  clearJob(id, "research");
  resetJobAttempts(id, "research");
  setOneshotStopReason(id, null);
  startResearch(id);
  kickOneshot(loaded.issue);
  redirect(`/issues/${id}`);
}

export async function retryStageAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  const stage = loaded.issue.currentStage;
  clearJob(id, stage);
  resetJobAttempts(id, stage);
  appendEvent(id, `${stage}.retry`, {}, { source: "operator", reason: "re-run" });
  switch (stage) {
    case "research":
      startResearch(id);
      break;
    case "grill":
      startGrill(id);
      break;
    case "spec":
      startSpec(id);
      break;
    case "improve":
    case "plan_pack":
    case "council":
    case "architecture":
    case "evidence":
    case "merge":
    case "hygiene":
      startWalkStage(id);
      break;
    case "execute":
      startExecute(id);
      break;
    case "intake":
      break;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
  setOneshotStopReason(id, null);
  kickOneshot(loaded.issue);
  redirect(`/issues/${id}`);
}

export async function completeStageAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  const stage = loaded.issue.currentStage;
  if (stage === "grill" && String(formData.get("confirm") ?? "") !== "1") {
    throw new Error("Confirm Finish grill now");
  }
  if (stage === "grill") {
    saveGrillSummary(id);
    clearJob(id, "grill");
    completeActiveStage(id, { source: "operator", reason: "force-finish" });
    startSpec(id);
  } else {
    completeActiveStage(id, { source: "operator", reason: "manual-complete" });
  }
  redirect(`/issues/${id}`);
}

export async function answerTicketAction(formData: FormData) {
  const issueId = String(formData.get("issueId") ?? "").trim();
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  requireIssue(issueId);
  if (!ticketId || !answer) throw new Error("answer is required");
  answerDecisionTicket(ticketId, answer);
  if (unansweredTicketCount(issueId) === 0 && !isGrillHeld(issueId)) {
    startGrill(issueId);
  }
  redirect(`/issues/${issueId}`);
}

export async function anotherGrillRoundAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  requireIssue(id);
  if (unansweredTicketCount(id) > 0) {
    throw new Error("Answer every Decision ticket first");
  }
  appendEvent(id, "grill.manual_advance", {}, { source: "operator", reason: "manual-advance" });
  startGrill(id);
  redirect(`/issues/${id}`);
}

export async function holdGrillAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  if (loaded.issue.currentStage !== "grill") throw new Error("Hold is only available during grill");
  clearJob(id, "grill");
  setGrillHold(id, true);
  redirect(`/issues/${id}`);
}

export async function releaseGrillAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  if (loaded.issue.currentStage !== "grill") throw new Error("Release hold is only available during grill");
  setGrillHold(id, false);
  if (unansweredTicketCount(id) === 0) startGrill(id);
  redirect(`/issues/${id}`);
}

export async function reopenTicketAction(formData: FormData) {
  const issueId = String(formData.get("issueId") ?? "").trim();
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const loaded = requireIssue(issueId);
  if (loaded.issue.currentStage !== "grill") {
    throw new Error("Reopen is only available during grill");
  }
  if (!ticketId) throw new Error("ticket is required");
  clearJob(issueId, "grill");
  clearTicketAnswer(ticketId);
  redirect(`/issues/${issueId}`);
}

export async function pauseOneshotAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  if (loaded.issue.runMode !== "oneshot") throw new Error("Pause is only for One shot Issues");
  setWalkHold(id, true);
  redirect(`/issues/${id}`);
}

export async function resumeOneshotAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  if (loaded.issue.runMode !== "oneshot") throw new Error("Resume is only for One shot Issues");
  setOneshotStopReason(id, null);
  setWalkHold(id, false);
  if (loaded.issue.currentStage !== "merge") {
    clearJob(id, loaded.issue.currentStage);
    resetJobAttempts(id, loaded.issue.currentStage);
  }
  startOneshotWalk(id);
  redirect(`/issues/${id}`);
}

export async function cancelOneshotAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  if (loaded.issue.runMode !== "oneshot") throw new Error("Cancel One shot is only for One shot Issues");
  cancelOneshot(id);
  redirect(`/issues/${id}`);
}

export async function createProjectAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const targetUrl = String(formData.get("targetUrl") ?? "").trim();
  if (!name || !targetUrl) throw new Error("name and targetUrl are required");
  createProject({ name, targetUrl });
  redirect("/projects");
}

export async function createCycleAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const startsAt = String(formData.get("startsAt") ?? "").trim();
  const endsAt = String(formData.get("endsAt") ?? "").trim();
  if (!name || !startsAt || !endsAt) throw new Error("name and dates are required");
  createCycle({ name, startsAt, endsAt, status: "active" });
  redirect("/cycles");
}

export async function createModuleAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!name || !projectId || !getProject(projectId)) throw new Error("project and name are required");
  createModule({ projectId, name });
  redirect("/modules");
}

export async function assignIssueAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  requireIssue(id);
  const projectId = String(formData.get("projectId") ?? "").trim() || undefined;
  const cycleId = String(formData.get("cycleId") ?? "").trim() || undefined;
  const moduleId = String(formData.get("moduleId") ?? "").trim() || undefined;
  assignIssue(id, { projectId, cycleId, moduleId });
  redirect(`/issues/${id}`);
}

export async function retryStageFromWorkersAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim() as StageId;
  const loaded = requireIssue(id);
  clearJob(id, stage);
  resetJobAttempts(id, stage);
  if (loaded.issue.runMode === "oneshot") {
    setOneshotStopReason(id, null);
    startOneshotWalk(id);
  }
  switch (stage) {
    case "research":
      startResearch(id);
      break;
    case "grill":
      startGrill(id);
      break;
    case "spec":
      startSpec(id);
      break;
    case "improve":
    case "plan_pack":
    case "council":
    case "architecture":
    case "evidence":
    case "merge":
    case "hygiene":
      startWalkStage(id);
      break;
    case "execute":
      startExecute(id);
      break;
    case "intake":
      break;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
  redirect("/workers");
}

/**
 * Apply a durable control mutation through the store's integer-version CAS.
 * A stale write or an out-of-bounds patch changes nothing and redirects to the
 * live control state; unexpected errors rethrow. No mutation here starts a pass.
 */
function mutateAutomationControl(patch: AutomationControlPatch, expectedVersion: number): void {
  const store = createAutomationControlStore();
  try {
    store.update(patch, expectedVersion);
  } catch (error) {
    if (
      error instanceof AutomationControlStaleVersionError ||
      error instanceof AutomationControlValidationError
    ) {
      return;
    }
    throw error;
  }
}

export async function automationControlAction(formData: FormData) {
  const op = String(formData.get("op") ?? "").trim();
  const version = Number(formData.get("version"));
  let patch: AutomationControlPatch | null = null;
  if (op === "enable") {
    patch = { enabled: true };
  } else if (op === "disable") {
    patch = { enabled: false };
  } else if (op === "pause") {
    patch = { operatorHold: true };
  } else if (op === "resume") {
    patch = { operatorHold: false };
  }
  if (patch === null) redirect("/automation");
  mutateAutomationControl(patch, version);
  redirect("/automation");
}

/**
 * Parse a numeric form field strictly. A missing, blank, or non-finite value
 * yields `undefined` so the caller leaves the stored value unchanged — an
 * empty input never coerces to `0` and silently clobbers a ceiling. Only a
 * finite number is returned.
 */
function parseNumericField(formData: FormData, name: string): number | undefined {
  const raw = formData.get(name);
  if (raw === null) return undefined;
  const text = String(raw).trim();
  if (text === "") return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  return value;
}

export async function automationSettingsAction(formData: FormData) {
  const version = Number(formData.get("version"));
  const store = createAutomationControlStore();
  const current = store.get();
  const patch: AutomationControlPatch = {};
  const limit = parseNumericField(formData, "limit");
  if (limit !== undefined && limit !== current.limit) patch.limit = limit;
  const maxIterations = parseNumericField(formData, "maxIterations");
  if (maxIterations !== undefined && maxIterations !== current.maxIterations) {
    patch.maxIterations = maxIterations;
  }
  const maxCostUsd = parseNumericField(formData, "maxCostUsd");
  if (maxCostUsd !== undefined && maxCostUsd !== current.maxCostUsd) patch.maxCostUsd = maxCostUsd;
  const perCandidateCeilingUsd = parseNumericField(formData, "perCandidateCeilingUsd");
  if (
    perCandidateCeilingUsd !== undefined &&
    perCandidateCeilingUsd !== current.perCandidateCeilingUsd
  ) {
    patch.perCandidateCeilingUsd = perCandidateCeilingUsd;
  }
  const paidAuthorization = formData.get("paidAuthorization") === "on";
  if (paidAuthorization !== current.paidAuthorization) patch.paidAuthorization = paidAuthorization;
  mutateAutomationControl(patch, version);
  redirect("/automation");
}
