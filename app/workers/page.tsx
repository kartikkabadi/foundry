import { retryStageFromWorkersAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { jobStatusLabel, STAGE_LABEL } from "@/lib/foundry/copy";
import { getIssue, listJobs } from "@/lib/foundry/store";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function WorkersPage() {
  const jobs = listJobs();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Workers</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Running, failed, and stalled jobs. A stalled worker is not still working.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {jobs.length === 0 ? (
          <li className="rounded-md border border-border p-4 text-muted-foreground">
            No workers have run yet. Opening an Issue starts research. Failed and stalled jobs stay
            here until you clear them.
          </li>
        ) : (
          jobs.map((job) => {
            const loaded = getIssue(job.issueId);
            return (
              <li className="flex items-center justify-between gap-4 rounded-md border border-border p-4" key={`${job.issueId}-${job.stage}`}>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {STAGE_LABEL[job.stage]} · {jobStatusLabel(job.status)}
                  </div>
                  <Link className="mt-1 block" href={`/issues/${job.issueId}`}>
                    {loaded?.issue.idea ?? job.issueId}
                  </Link>
                  {job.error ? <p className="mt-2 text-sm text-muted-foreground">{job.error}</p> : null}
                </div>
                {job.status !== "running" ? (
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
