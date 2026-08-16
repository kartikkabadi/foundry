import { STAGE_LABEL } from "@/lib/foundry/copy";
import { listGateIssues } from "@/lib/foundry/store";
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
          Hard stops. Grill, plan pack, build, and evidence wait here until you act.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {issues.length === 0 ? (
          <li className="text-muted-foreground">Nothing is waiting on you.</li>
        ) : (
          issues.map((issue) => (
            <li key={issue.id}>
              <Link className="block rounded-md border border-border p-4 hover:bg-accent" href={`/issues/${issue.id}`}>
                <div className="text-xs text-muted-foreground">
                  {gateFor(issue.currentStage)} · {STAGE_LABEL[issue.currentStage]}
                </div>
                <div className="mt-1">{issue.idea}</div>
              </Link>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
