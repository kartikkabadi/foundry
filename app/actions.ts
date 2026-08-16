"use server";

import { redirect } from "next/navigation";
import { startGrill } from "@/lib/foundry/grill";
import { startResearch } from "@/lib/foundry/research";
import { startSpec } from "@/lib/foundry/spec";
import {
  answerDecisionTicket,
  assignIssue,
  clearJob,
  completeActiveStage,
  createCycle,
  createIssue,
  createModule,
  createProject,
  getIssue,
  getProject,
  unansweredTicketCount,
} from "@/lib/foundry/store";
import { startWalkStage } from "@/lib/foundry/walk";
import { type IssueSize, type StageId } from "@/lib/foundry/types";

const SIZES: IssueSize[] = ["xs", "s", "m", "l", "forced_l"];

function requireIssue(id: string) {
  const loaded = getIssue(id);
  if (!id || !loaded) throw new Error("issue not found");
  return loaded;
}

export async function createIssueAction(formData: FormData) {
  const idea = String(formData.get("idea") ?? "").trim();
  const targetUrl = String(formData.get("targetUrl") ?? "").trim();
  const sizeRaw = String(formData.get("size") ?? "s");
  const size = SIZES.includes(sizeRaw as IssueSize) ? (sizeRaw as IssueSize) : "s";
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
    projectId,
    cycleId,
    moduleId,
  });
  startResearch(issue.id);
  redirect(`/issues/${issue.id}`);
}

export async function retryResearchAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  requireIssue(id);
  clearJob(id, "research");
  startResearch(id);
  redirect(`/issues/${id}`);
}

export async function retryStageAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  const stage = loaded.issue.currentStage;
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
    case "execute":
    case "evidence":
    case "merge":
    case "hygiene":
      startWalkStage(id);
      break;
    case "intake":
      break;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
  redirect(`/issues/${id}`);
}

export async function completeStageAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const loaded = requireIssue(id);
  if (loaded.issue.currentStage === "grill" && unansweredTicketCount(id) > 0) {
    throw new Error("Answer every Decision ticket first");
  }
  completeActiveStage(id);
  redirect(`/issues/${id}`);
}

export async function answerTicketAction(formData: FormData) {
  const issueId = String(formData.get("issueId") ?? "").trim();
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  requireIssue(issueId);
  if (!ticketId || !answer) throw new Error("answer is required");
  answerDecisionTicket(ticketId, answer);
  redirect(`/issues/${issueId}`);
}

export async function anotherGrillRoundAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  requireIssue(id);
  if (unansweredTicketCount(id) > 0) {
    throw new Error("Answer every Decision ticket first");
  }
  startGrill(id);
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
  redirect("/workers");
}
