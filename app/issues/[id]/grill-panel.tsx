import {
  anotherGrillRoundAction,
  answerTicketAction,
  completeStageAction,
  holdGrillAction,
  releaseGrillAction,
  reopenTicketAction,
  retryStageAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { GRILL_EMPTY_NOT_DONE } from "@/lib/foundry/grill";
import type { DecisionTicket, IssueJob } from "@/lib/foundry/types";

export function GrillPanel({
  tickets,
  job,
  issueId,
  held,
}: {
  tickets: DecisionTicket[];
  job: IssueJob | null;
  issueId: string;
  held: boolean;
}) {
  const unanswered = tickets.filter((ticket) => !ticket.answer);
  if (job?.status === "running") {
    return (
      <section className="flex flex-col gap-4 rounded-md border border-border p-5">
        <div className="flex items-center gap-2">
          <Spinner />
          Writing questions
        </div>
        <form action={holdGrillAction}>
          <input name="id" type="hidden" value={issueId} />
          <Button type="submit" variant="outline">
            Hold round
          </Button>
        </form>
      </section>
    );
  }
  if (job?.status === "failed" || job?.status === "stale") {
    const emptyNotDone = job.error === GRILL_EMPTY_NOT_DONE;
    return (
      <section className="flex flex-col gap-4 rounded-md border border-border p-5">
        <div>
          <p>{emptyNotDone ? "Grill did not finish" : job.status === "stale" ? "Grill stalled" : "Grill failed"}</p>
          <p className="mt-2 text-sm text-muted-foreground">{job.error ?? "Worker stopped."}</p>
        </div>
        <form action={retryStageAction}>
          <input name="id" type="hidden" value={issueId} />
          <Button type="submit">{emptyNotDone ? "Re-run round" : "Run grill again"}</Button>
        </form>
      </section>
    );
  }
  if (tickets.length === 0) {
    return (
      <p className="text-muted-foreground">
        No Decision tickets yet. If this sits still, the worker never started — retry from Workers.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Grill is the first hard stop. {unanswered.length} of {tickets.length} tickets still need an
        answer. The recommendation is a suggestion, not a decision until you say so.
        {held ? " This round is held. Release hold to let the next round start on its own." : null}
      </p>
      {tickets.map((ticket) => (
        <article
          className={`rounded-md border border-border p-4 ${ticket.answer ? "opacity-70" : ""}`}
          key={ticket.id}
        >
          <p className="text-xs text-muted-foreground">
            Round {ticket.round}
            {ticket.answer ? " · answered" : " · waiting on you"}
          </p>
          <p className="mt-2">{ticket.prompt}</p>
          <p className="mt-3 text-sm text-muted-foreground">Recommendation: {ticket.recommendation}</p>
          {ticket.priorMatch ? (
            <p className="mt-2 text-sm text-muted-foreground">Prior match: {ticket.priorMatch}</p>
          ) : null}
          {ticket.answer ? (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm">You: {ticket.answer}</p>
              <form action={reopenTicketAction}>
                <input name="issueId" type="hidden" value={issueId} />
                <input name="ticketId" type="hidden" value={ticket.id} />
                <Button type="submit" variant="outline">
                  Reopen answer
                </Button>
              </form>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <form action={answerTicketAction} className="flex flex-col gap-2">
                <input name="issueId" type="hidden" value={issueId} />
                <input name="ticketId" type="hidden" value={ticket.id} />
                <textarea
                  className="min-h-20 rounded-md border border-input bg-background p-3"
                  name="answer"
                  placeholder="Your decision"
                  required
                />
                <Button className="w-fit" type="submit">
                  Record decision
                </Button>
              </form>
              <form action={answerTicketAction}>
                <input name="issueId" type="hidden" value={issueId} />
                <input name="ticketId" type="hidden" value={ticket.id} />
                <input name="answer" type="hidden" value={ticket.recommendation} />
                <Button type="submit" variant="outline">
                  Use recommendation
                </Button>
              </form>
            </div>
          )}
        </article>
      ))}
      {unanswered.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {held
              ? "Frontier is empty. Release hold to start the next round, or finish grill now."
              : "Frontier is empty. The next round starts on its own unless you hold or finish grill now."}
          </p>
          <div className="flex flex-wrap gap-3">
            {held ? (
              <form action={releaseGrillAction}>
                <input name="id" type="hidden" value={issueId} />
                <Button type="submit">Release hold</Button>
              </form>
            ) : (
              <form action={holdGrillAction}>
                <input name="id" type="hidden" value={issueId} />
                <Button type="submit" variant="outline">
                  Hold round
                </Button>
              </form>
            )}
            <form action={anotherGrillRoundAction}>
              <input name="id" type="hidden" value={issueId} />
              <Button type="submit" variant="outline">
                Another round
              </Button>
            </form>
          </div>
        </div>
      ) : held ? (
        <form action={releaseGrillAction}>
          <input name="id" type="hidden" value={issueId} />
          <Button type="submit" variant="outline">
            Release hold
          </Button>
        </form>
      ) : (
        <form action={holdGrillAction}>
          <input name="id" type="hidden" value={issueId} />
          <Button type="submit" variant="outline">
            Hold round
          </Button>
        </form>
      )}
      <form action={completeStageAction} className="flex flex-col gap-2 rounded-md border border-border p-4">
        <input name="id" type="hidden" value={issueId} />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input name="confirm" type="checkbox" value="1" required />
          Leave grill and start spec
          {unanswered.length > 0 ? ` (${unanswered.length} tickets still open)` : null}
        </label>
        <Button className="w-fit" type="submit">
          Finish grill now
        </Button>
      </form>
    </div>
  );
}
