import { startOneshotWalk } from "@/lib/foundry/oneshot";
import { startResearch } from "@/lib/foundry/research";
import { completeActiveStage, createIssue, getIssue, listIssues } from "@/lib/foundry/store";
import { parseRunMode, type IssueSize } from "@/lib/foundry/types";

export const runtime = "nodejs";

const SIZES: IssueSize[] = ["xs", "s", "m", "l", "forced_l"];

export function GET() {
  return Response.json({ issues: listIssues() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    idea?: string;
    targetUrl?: string;
    size?: string;
    runMode?: string;
  };
  const idea = body.idea?.trim();
  const targetUrl = body.targetUrl?.trim();
  const size = SIZES.includes(body.size as IssueSize) ? (body.size as IssueSize) : "s";
  const runMode = parseRunMode(body.runMode);
  if (!idea || !targetUrl) {
    return Response.json({ error: "idea and targetUrl are required" }, { status: 400 });
  }
  const issue = createIssue({ idea, targetUrl, size, runMode });
  startResearch(issue.id);
  if (runMode === "oneshot") startOneshotWalk(issue.id);
  return Response.json({ issue });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: string };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
  if (!getIssue(body.id)) return Response.json({ error: "not found" }, { status: 404 });
  const issue = completeActiveStage(body.id);
  return Response.json({ issue });
}
