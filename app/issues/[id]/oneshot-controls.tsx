import { cancelOneshotAction, pauseOneshotAction, resumeOneshotAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { isOneshotWalking, type Issue } from "@/lib/foundry/types";

export function OneshotControls({ issue }: { issue: Issue }) {
  if (issue.runMode !== "oneshot") return null;
  const walking = isOneshotWalking(issue);
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-4">
      <p className="text-sm">
        <span className="text-foreground">One shot</span>
        <span className="text-muted-foreground">
          {issue.walkHold
            ? " · paused. Foundry is not auto-resolving gates."
            : issue.oneshotStopReason
              ? " · stopped."
              : " · walking. Gates auto-resolve from worker recommendations. You can override any Decision ticket."}
        </span>
      </p>
      {issue.oneshotStopReason ? (
        <p className="text-sm text-muted-foreground">{issue.oneshotStopReason}</p>
      ) : walking ? (
        <p className="text-sm text-muted-foreground">
          Does not merge to GitHub. Stops before merge until evidence/CI merge is real.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {issue.walkHold || issue.oneshotStopReason ? (
          <form action={resumeOneshotAction}>
            <input name="id" type="hidden" value={issue.id} />
            <Button type="submit" variant="outline">
              Resume One shot
            </Button>
          </form>
        ) : (
          <form action={pauseOneshotAction}>
            <input name="id" type="hidden" value={issue.id} />
            <Button type="submit" variant="outline">
              Pause
            </Button>
          </form>
        )}
        <form action={cancelOneshotAction}>
          <input name="id" type="hidden" value={issue.id} />
          <Button type="submit" variant="ghost">
            Cancel One shot
          </Button>
        </form>
      </div>
    </section>
  );
}
