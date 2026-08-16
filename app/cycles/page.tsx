import { createCycleAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { listCycles, listIssuesByCycle } from "@/lib/foundry/store";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function CyclesPage() {
  const cycles = listCycles();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Cycles</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Timeboxed batches of Issues. Not a sprint burndown — a factory window.
        </p>
      </header>
      <form action={createCycleAction} className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-3">
        <input className="rounded-md border border-input bg-background p-3 sm:col-span-3" name="name" placeholder="Name" required />
        <input className="rounded-md border border-input bg-background p-3" name="startsAt" placeholder="Starts (YYYY-MM-DD)" required />
        <input className="rounded-md border border-input bg-background p-3" name="endsAt" placeholder="Ends (YYYY-MM-DD)" required />
        <Button className="w-fit" type="submit">
          Open cycle
        </Button>
      </form>
      <ul className="flex flex-col gap-2">
        {cycles.length === 0 ? (
          <li className="rounded-md border border-border p-4 text-muted-foreground">
            No cycles yet. Open a window if you want Issues grouped by time. The factory still runs
            without one.
          </li>
        ) : (
          cycles.map((cycle) => {
          const issues = listIssuesByCycle(cycle.id);
          return (
            <li className="rounded-md border border-border p-4" key={cycle.id}>
              <div className="font-medium">{cycle.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {cycle.status} · {cycle.startsAt} → {cycle.endsAt}
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {issues.length === 0 ? (
                  <li className="text-muted-foreground">No issues in this cycle.</li>
                ) : (
                  issues.map((issue) => (
                    <li key={issue.id}>
                      <Link href={`/issues/${issue.id}`}>{issue.idea}</Link>
                    </li>
                  ))
                )}
              </ul>
            </li>
          );
        })
        )}
      </ul>
    </main>
  );
}
