"use server";

import { redirect } from "next/navigation";
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
  createCycle,
  createIssue,
  createModule,
  createProject,
  getIssue,
  getProject,
  isGrillHeld,
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
  requireIssue(id);
  clearJob(id, stage);
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
