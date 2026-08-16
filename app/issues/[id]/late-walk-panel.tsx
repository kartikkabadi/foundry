import { WalkDocPanel } from "@/app/issues/[id]/walk-doc-panel";
import type { IssueArtifact, IssueJob, StageId } from "@/lib/foundry/types";

const LATE_STAGES: StageId[] = ["execute", "evidence", "merge", "hygiene"];

export function LateWalkPanel({
  stage,
  artifact,
  job,
  issueId,
}: {
  stage: StageId;
  artifact: IssueArtifact | null;
  job: IssueJob | null;
  issueId: string;
}) {
  const resolved = LATE_STAGES.includes(stage) ? stage : "execute";
  return <WalkDocPanel artifact={artifact} issueId={issueId} job={job} stage={resolved} />;
}
