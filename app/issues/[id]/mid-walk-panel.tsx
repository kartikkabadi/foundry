import { WalkDocPanel } from "@/app/issues/[id]/walk-doc-panel";
import type { IssueArtifact, IssueJob, StageId } from "@/lib/foundry/types";

const MID_STAGES: StageId[] = ["improve", "plan_pack", "council", "architecture"];

export function MidWalkPanel({
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
  const resolved = MID_STAGES.includes(stage) ? stage : "improve";
  return <WalkDocPanel artifact={artifact} issueId={issueId} job={job} stage={resolved} />;
}
