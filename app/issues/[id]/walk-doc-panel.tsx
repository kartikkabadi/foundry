import { completeStageAction, retryStageAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { STAGE_LABEL, jobVerb } from "@/lib/foundry/copy";
import { parseWalkDoc } from "@/lib/foundry/walk";
import type { IssueArtifact, IssueJob, StageId } from "@/lib/foundry/types";

export function WalkDocPanel({
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
  if (job?.status === "running" && !artifact) {
    return (
      <section className="flex items-center gap-2 rounded-md border border-border p-5">
        <Spinner />
        {jobVerb(stage)}
      </section>
    );
  }
  if ((job?.status === "failed" || job?.status === "stale") && !artifact) {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-border p-5">
        <p>{job.error ?? `${STAGE_LABEL[stage]} worker stopped.`}</p>
        <form action={retryStageAction}>
          <input name="id" type="hidden" value={issueId} />
          <Button type="submit">Retry</Button>
        </form>
      </section>
    );
  }
  const doc = artifact ? parseWalkDoc(artifact.body) : null;
  if (!doc) {
    return <p className="text-muted-foreground">No {STAGE_LABEL[stage]} document yet.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">{doc.title}</h2>
      <p className="whitespace-pre-wrap">{doc.body}</p>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {doc.nextActions.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <form action={completeStageAction}>
        <input name="id" type="hidden" value={issueId} />
        <Button type="submit">Continue</Button>
      </form>
    </div>
  );
}
