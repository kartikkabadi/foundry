import { getArtifact, getIssue, getJob } from "@/lib/foundry/store";
import { parseResearchBrief } from "@/lib/foundry/research";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = getIssue(id);
  if (!loaded) return Response.json({ error: "not found" }, { status: 404 });
  const artifact = getArtifact(id, "research_brief");
  return Response.json({
    ...loaded,
    job: getJob(id, loaded.issue.currentStage),
    researchBrief: artifact ? parseResearchBrief(artifact.body) : null,
  });
}
