import Link from "next/link";
import { notFound } from "next/navigation";
import { getIssue } from "@/lib/foundry/store";
import { STAGES } from "@/lib/foundry/types";
import { IssueGraph } from "./issue-graph";
import { AdvanceStage } from "./advance-stage";

export const runtime = "nodejs";

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = getIssue(id);
  if (!loaded) notFound();
  const { issue, stages } = loaded;
  const byId = new Map(stages.map((stage) => [stage.stage, stage]));

  return (
    <main className="min-h-screen bg-black text-neutral-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
        <p className="text-sm text-neutral-500">
          <Link href="/">Foundry</Link> / {issue.id.slice(0, 8)}
        </p>
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-medium">Issue walk</h1>
          <p className="max-w-3xl text-neutral-400">{issue.idea}</p>
          <p className="font-mono text-sm text-neutral-500">
            {issue.size} · {issue.currentStage} · {issue.targetUrl}
          </p>
        </header>
        <IssueGraph stages={stages} />
        <AdvanceStage id={issue.id} />
        <aside className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          {STAGES.map((id) => {
            const row = byId.get(id);
            return (
              <div className="border border-neutral-800 p-3" key={id}>
                <div className="font-mono text-xs text-neutral-500">{id}</div>
                <div>{row?.status ?? "pending"}</div>
                {row?.skipReason ? <div className="text-neutral-500">{row.skipReason}</div> : null}
              </div>
            );
          })}
        </aside>
      </div>
    </main>
  );
}
