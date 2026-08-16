import { RetryResearch } from "@/app/issues/[id]/retry-research";
import { Spinner } from "@/components/ui/spinner";
import type { IssueJob, ResearchBrief } from "@/lib/foundry/types";

export function ResearchPanel({
  brief,
  job,
  issueId,
}: {
  brief: ResearchBrief | null;
  job: IssueJob | null;
  issueId: string;
}) {
  if (job?.status === "running" && !brief) {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-border p-5">
        <div className="flex items-center gap-2">
          <Spinner />
          Reading the repo
        </div>
        <p className="text-muted-foreground">
          Foundry is looking at CONTEXT.md and the app so it can ask you useful questions next. This
          can take a couple of minutes.
        </p>
      </section>
    );
  }
  if ((job?.status === "failed" || job?.status === "stale") && !brief) {
    return (
      <section className="flex flex-col gap-4 rounded-md border border-border p-5">
        <div>
          <p>{job.status === "stale" ? "Research stalled" : "Research failed"}</p>
          <p className="mt-2 text-sm text-muted-foreground">{job.error ?? "Worker stopped."}</p>
        </div>
        <RetryResearch id={issueId} />
      </section>
    );
  }
  if (!brief) {
    return <p className="text-muted-foreground">No brief yet.</p>;
  }
  return (
    <div className="flex flex-col gap-8">
      <BriefSection title="In plain English" body={brief.inPlainEnglish} />
      <BriefSection title="What this repo is" body={brief.whatTheRepoIs} />
      <BriefSection title="What your idea would change" body={brief.whatThisIdeaWouldChange} />
      <BriefList title="Constraints already in the repo" items={brief.constraints} />
      <BriefList title="Risks" items={brief.risks} />
      <BriefList title="Questions you will need to answer" items={brief.questionsForYou} />
    </div>
  );
}

function BriefSection({ title, body }: { title: string; body: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm text-muted-foreground">{title}</h2>
      <p className="whitespace-pre-wrap text-foreground">{body}</p>
    </section>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm text-muted-foreground">{title}</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
