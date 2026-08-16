import { completeStageAction, retryStageAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { parseSpec } from "@/lib/foundry/spec";
import type { IssueArtifact, IssueJob } from "@/lib/foundry/types";

export function SpecPanel({
  artifact,
  job,
  issueId,
}: {
  artifact: IssueArtifact | null;
  job: IssueJob | null;
  issueId: string;
}) {
  if (job?.status === "running" && !artifact) {
    return (
      <section className="flex items-center gap-2 rounded-md border border-border p-5">
        <Spinner />
        Writing the spec
      </section>
    );
  }
  if ((job?.status === "failed" || job?.status === "stale") && !artifact) {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-border p-5">
        <p>{job.error ?? "Spec worker stopped."}</p>
        <form action={retryStageAction}>
          <input name="id" type="hidden" value={issueId} />
          <Button type="submit">Retry spec</Button>
        </form>
      </section>
    );
  }
  const doc = artifact ? parseSpec(artifact.body) : null;
  if (!doc) {
    return <p className="text-muted-foreground">No spec stored yet.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">{doc.title}</h2>
      <p className="whitespace-pre-wrap">{doc.spec}</p>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {doc.acceptance.map((item) => (
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
