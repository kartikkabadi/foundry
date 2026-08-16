import { anotherGrillRoundAction, answerTicketAction, completeStageAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { DecisionTicket, IssueJob } from "@/lib/foundry/types";

export function GrillPanel({
  tickets,
  job,
  issueId,
}: {
  tickets: DecisionTicket[];
  job: IssueJob | null;
  issueId: string;
}) {
  const unanswered = tickets.filter((ticket) => !ticket.answer);
  if (job?.status === "running") {
    return (
      <section className="flex items-center gap-2 rounded-md border border-border p-5">
        <Spinner />
        Writing questions
      </section>
    );
  }
  if (job?.status === "failed" || job?.status === "stale") {
    return (
      <section className="rounded-md border border-border p-5">
        <p>{job.status === "stale" ? "Grill stalled" : "Grill failed"}</p>
        <p className="mt-2 text-sm text-muted-foreground">{job.error}</p>
      </section>
    );
  }
  if (tickets.length === 0) {
    return <p className="text-muted-foreground">No Decision tickets yet.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Grill is the first hard stop. Answer every Decision ticket. The recommendation is a suggestion,
        not a decision until you say so.
      </p>
      {tickets.map((ticket) => (
        <article className="rounded-md border border-border p-4" key={ticket.id}>
          <p className="text-xs text-muted-foreground">Round {ticket.round}</p>
          <p className="mt-2">{ticket.prompt}</p>
          <p className="mt-3 text-sm text-muted-foreground">Recommendation: {ticket.recommendation}</p>
          {ticket.priorMatch ? (
            <p className="mt-2 text-sm text-muted-foreground">Prior match: {ticket.priorMatch}</p>
          ) : null}
          {ticket.answer ? (
            <p className="mt-3 text-sm">You: {ticket.answer}</p>
          ) : (
            <form action={answerTicketAction} className="mt-4 flex flex-col gap-2">
              <input name="issueId" type="hidden" value={issueId} />
              <input name="ticketId" type="hidden" value={ticket.id} />
              <textarea
                className="min-h-20 rounded-md border border-input bg-background p-3"
                name="answer"
                required
              />
              <Button className="w-fit" type="submit">
                Record decision
              </Button>
            </form>
          )}
        </article>
      ))}
      {unanswered.length === 0 ? (
        <div className="flex gap-3">
          <form action={anotherGrillRoundAction}>
            <input name="id" type="hidden" value={issueId} />
            <Button type="submit" variant="outline">
              Another round
            </Button>
          </form>
          <form action={completeStageAction}>
            <input name="id" type="hidden" value={issueId} />
            <Button type="submit">Finish grill</Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
