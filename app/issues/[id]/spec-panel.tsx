import { completeStageAction, retryStageAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { parseGrillSummary } from "@/lib/foundry/grill";
import { parseSpec } from "@/lib/foundry/spec";
import type { IssueArtifact, IssueJob } from "@/lib/foundry/types";

export function SpecPanel({
  artifact,
  job,
  issueId,
  summary,
}: {
  artifact: IssueArtifact | null;
  job: IssueJob | null;
  issueId: string;
  summary: IssueArtifact | null;
}) {
  const grill = summary ? parseGrillSummary(summary.body) : null;
  const summaryBlock =
    grill && grill.tickets.length > 0 ? (
      <section className="flex flex-col gap-3 rounded-md border border-border p-4">
        <h2 className="text-sm text-muted-foreground">{grill.title}</h2>
        <ul className="flex flex-col gap-3">
          {grill.tickets.map((ticket, index) => (
            <li className="text-sm" key={`${ticket.round}-${index}`}>
              <p className="text-muted-foreground">Round {ticket.round}</p>
              <p className="mt-1">{ticket.prompt}</p>
              <p className="mt-1">You: {ticket.answer ?? "(unanswered)"}</p>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  if (job?.status === "running" && !artifact) {
    return (
      <div className="flex flex-col gap-6">
        {summaryBlock}
        <section className="flex items-center gap-2 rounded-md border border-border p-5">
          <Spinner />
          Writing the spec
        </section>
      </div>
    );
  }
  if ((job?.status === "failed" || job?.status === "stale") && !artifact) {
    return (
      <div className="flex flex-col gap-6">
        {summaryBlock}
        <section className="flex flex-col gap-3 rounded-md border border-border p-5">
          <p>{job.error ?? "Spec worker stopped."}</p>
          <form action={retryStageAction}>
            <input name="id" type="hidden" value={issueId} />
            <Button type="submit">Retry spec</Button>
          </form>
        </section>
      </div>
    );
  }
  const doc = artifact ? parseSpec(artifact.body) : null;
  if (!doc) {
    return (
      <div className="flex flex-col gap-6">
        {summaryBlock}
        <p className="text-muted-foreground">No spec stored yet.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {summaryBlock}
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
