import { STAGE_LABEL, gateNowWhat } from "@/lib/foundry/copy";
import { listGateIssues, unansweredTicketCount } from "@/lib/foundry/store";
import { gateFor } from "@/lib/foundry/types";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function GatesPage() {
  const issues = listGateIssues();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Gates</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Hard stops. Grill, plan pack, build, and evidence wait here until you act. Everything else
          is a worker, not a gate.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {issues.length === 0 ? (
          <li className="rounded-md border border-border p-4 text-muted-foreground">
            Nothing is waiting on you. Issues show up here only when they hit grill, plan pack, build,
            or evidence.
          </li>
        ) : (
          issues.map((issue) => {
            const remaining =
              issue.currentStage === "grill" ? unansweredTicketCount(issue.id) : null;
            return (
              <li key={issue.id}>
                <Link
                  className="block rounded-md border border-border p-4 hover:bg-accent"
                  href={`/issues/${issue.id}`}
                >
                  <div className="text-xs text-muted-foreground">
                    {gateFor(issue.currentStage)} · {STAGE_LABEL[issue.currentStage]}
                    {remaining !== null
                      ? ` · ${remaining} ticket${remaining === 1 ? "" : "s"} unanswered`
                      : null}
                  </div>
                  <div className="mt-1">{issue.idea}</div>
                  <div className="mt-2 text-sm text-foreground">{gateNowWhat(issue.currentStage)}</div>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </main>
  );
}
