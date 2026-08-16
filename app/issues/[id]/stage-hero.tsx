import { STAGE_LABEL, jobVerb, nowWhat } from "@/lib/foundry/copy";
import type { Issue, IssueJob } from "@/lib/foundry/types";
import { gateFor } from "@/lib/foundry/types";

export function StageHero({
  issue,
  job,
  unansweredTickets = 0,
}: {
  issue: Issue;
  job: IssueJob | null;
  unansweredTickets?: number;
}) {
  const gate = gateFor(issue.currentStage);
  const running = job?.status === "running";
  const failed = job?.status === "failed";
  const stale = job?.status === "stale";
  return (
    <header className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Current stage</p>
      <p className="text-sm text-muted-foreground">
        {STAGE_LABEL[issue.currentStage]}
        {gate ? ` · ${gate} gate` : null}
        {running ? ` · ${jobVerb(issue.currentStage)}` : null}
        {failed ? " · failed" : null}
        {stale ? " · stalled" : null}
      </p>
      <h1 className="text-2xl font-medium tracking-tight">{issue.idea}</h1>
      <p className="max-w-2xl text-sm text-foreground">
        {nowWhat(issue.currentStage, job, { unansweredTickets })}
      </p>
    </header>
  );
}
