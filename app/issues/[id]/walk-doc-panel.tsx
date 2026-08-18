import { completeStageAction, retryStageAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { STAGE_LABEL, jobVerb } from "@/lib/foundry/copy";
import { parseWalkDoc } from "@/lib/foundry/walk";
import { parseExecuteArtifact } from "@/lib/foundry/execute";
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
  if (stage === "execute" && artifact) {
    const executeResult = parseExecuteArtifact(artifact.body);
    if (executeResult) {
      return (
        <div className="flex flex-col gap-6">
          <h2 className="text-lg font-medium">Pull Request Created</h2>
          <div className="flex flex-col gap-2">
            <a
              href={executeResult.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {executeResult.prUrl}
            </a>
            <p className="text-muted-foreground">Branch: {executeResult.branchName}</p>
            <p className="text-muted-foreground">Commit: {executeResult.commitMessage}</p>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Files Changed</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {executeResult.filesChanged.map((file) => (
                <li key={file} className="text-sm text-muted-foreground">{file}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Test Results</h3>
            <pre className="whitespace-pre-wrap rounded-md bg-surface-1 p-3 text-sm">
              {executeResult.testResults}
            </pre>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Diff</h3>
            <pre className="whitespace-pre-wrap rounded-md bg-surface-1 p-3 text-sm">
              {executeResult.diff}
            </pre>
          </div>
          <form action={completeStageAction}>
            <input name="id" type="hidden" value={issueId} />
            <Button type="submit">Continue</Button>
          </form>
        </div>
      );
    }
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
