import { retryStageFromWorkersAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { jobStatusLabel, STAGE_LABEL } from "@/lib/foundry/copy";
import { isPermanentFailure, isRetryScheduled } from "@/lib/foundry/retry";
import { getIssue, listJobs } from "@/lib/foundry/store";
import { MAX_ATTEMPTS, type IssueJob, type StageId } from "@/lib/foundry/types";
import Link from "next/link";

const RETRYABLE_STAGES: StageId[] = [
  "research",
  "grill",
  "spec",
  "improve",
  "plan_pack",
  "council",
  "architecture",
  "execute",
  "evidence",
  "merge",
  "hygiene",
];

function isRetryableStage(stage: StageId): boolean {
  return RETRYABLE_STAGES.includes(stage);
}

function retryInfo(job: IssueJob) {
  if (isRetryScheduled(job)) {
    const waitMs = (job.nextRetryAt ? Date.parse(job.nextRetryAt) : 0) - Date.now();
    const label = waitMs > 0 ? `retrying in ${Math.ceil(waitMs / 1000)}s` : "retrying now";
    return { label, tone: "text-amber-200" as const };
  }
  if (isPermanentFailure(job)) {
    return { label: "permanent failure", tone: "text-red-300" as const };
  }
  return null;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function WorkersPage() {
  const jobs = listJobs();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Workers</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Running, failed, and stalled jobs. Transient failures auto-retry with backoff.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {jobs.length === 0 ? (
          <li className="rounded-md border border-border p-4 text-muted-foreground">
            No workers have run yet. Opening an Issue starts research. Failed and stalled jobs stay
            here until they auto-retry or you clear them.
          </li>
        ) : (
          jobs.map((job) => {
            const loaded = getIssue(job.issueId);
            const info = retryInfo(job);
            return (
              <li className="flex items-center justify-between gap-4 rounded-md border border-border p-4" key={`${job.issueId}-${job.stage}`}>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {STAGE_LABEL[job.stage]} · {jobStatusLabel(job.status)} · attempt {job.attempts}/{MAX_ATTEMPTS}
                    {info ? <span className={info.tone}> · {info.label}</span> : null}
                  </div>
                  <Link className="mt-1 block" href={`/issues/${job.issueId}`}>
                    {loaded?.issue.idea ?? job.issueId}
                  </Link>
                  {job.error ? <p className="mt-2 text-sm text-muted-foreground">{job.error}</p> : null}
                </div>
                {job.status !== "running" && isRetryableStage(job.stage) ? (
                  <form action={retryStageFromWorkersAction}>
                    <input name="id" type="hidden" value={job.issueId} />
                    <input name="stage" type="hidden" value={job.stage} />
                    <Button type="submit" variant="outline">
                      Clear
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </main>
  );
}
