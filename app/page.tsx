import { IntakeForm } from "@/app/_components/intake-form";
import { listIssues } from "@/lib/foundry/store";
import Link from "next/link";

export const runtime = "nodejs";

export default function Page() {
  const issues = listIssues();
  return (
    <main className="min-h-screen bg-black text-neutral-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 p-8">
        <header className="flex flex-col gap-2">
          <p className="text-sm text-neutral-500">Foundry</p>
          <h1 className="text-3xl font-medium">Put an idea in. Walk it as an Issue.</h1>
          <p className="max-w-2xl text-neutral-400">
            Human gates stay in this dashboard. Compute runs in Docker later. Data stays on disk.
          </p>
        </header>
        <IntakeForm />
        <section className="flex flex-col gap-3">
          <h2 className="text-lg">Issues</h2>
          {issues.length === 0 ? (
            <p className="text-neutral-500">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {issues.map((issue) => (
                <li key={issue.id}>
                  <Link className="block border border-neutral-800 p-3 hover:border-neutral-500" href={`/issues/${issue.id}`}>
                    <div className="font-mono text-xs text-neutral-500">
                      {issue.size} · {issue.currentStage}
                    </div>
                    <div>{issue.idea}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
