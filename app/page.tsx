import { IntakeForm } from "@/app/_components/intake-form";
import { issueListStatus } from "@/lib/foundry/copy";
import {
  getJob,
  listCycles,
  listGateIssues,
  listIssues,
  listJobs,
  listModules,
  listProjects,
} from "@/lib/foundry/store";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const spreadsheet = view === "table";
  const issues = listIssues();
  const projects = listProjects();
  const cycles = listCycles();
  const modules = listModules();
  const gates = listGateIssues();
  const stalled = listJobs().filter((job) => job.status === "stale" || job.status === "failed");

  return (
    <main className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-8">
        <header className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-medium tracking-tight">Issues</h1>
            <p className="text-sm text-muted-foreground">
              An idea becomes an Issue. The Issue walks the factory. You stop it at the gates.
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <Link className={spreadsheet ? "text-muted-foreground" : "text-foreground"} href="/">
              List
            </Link>
            <Link className={spreadsheet ? "text-foreground" : "text-muted-foreground"} href="/?view=table">
              Spreadsheet
            </Link>
          </div>
        </header>
        <IntakeForm cycles={cycles} modules={modules} projects={projects} />
        {spreadsheet ? (
          issues.length === 0 ? (
            <p className="text-muted-foreground">
              No issues yet. Open one above — research starts as soon as you submit.
            </p>
          ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Idea</th>
                <th className="py-2 font-medium">Stage</th>
                <th className="py-2 font-medium">Size</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => {
                const job = getJob(issue.id, issue.currentStage);
                return (
                  <tr className="border-t border-border" key={issue.id}>
                    <td className="py-2">
                      <Link href={`/issues/${issue.id}`}>{issue.idea}</Link>
                    </td>
                    <td className="py-2 text-muted-foreground">{issue.currentStage}</td>
                    <td className="py-2 text-muted-foreground">{issue.size}</td>
                    <td className="py-2 text-muted-foreground">{issueListStatus(issue.currentStage, job)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {issues.length === 0 ? (
              <li className="rounded-md border border-border p-4 text-muted-foreground">
                No issues yet. Open one above — research starts as soon as you submit.
              </li>
            ) : (
              issues.map((issue) => {
                const job = getJob(issue.id, issue.currentStage);
                return (
                  <li key={issue.id}>
                    <Link
                      className="block rounded-md border border-border p-3 hover:bg-accent"
                      href={`/issues/${issue.id}`}
                    >
                      <div className="text-xs text-muted-foreground">
                        {issueListStatus(issue.currentStage, job)}
                      </div>
                      <div className="mt-1">{issue.idea}</div>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
      <aside className="flex flex-col gap-4">
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm text-muted-foreground">Waiting on you</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {gates.length === 0 ? (
              <li className="text-muted-foreground">
                No open gates. Grill, plan pack, build, and evidence land here.
              </li>
            ) : (
              gates.map((issue) => (
                <li key={issue.id}>
                  <Link href={`/issues/${issue.id}`}>{issue.idea}</Link>
                </li>
              ))
            )}
          </ul>
        </section>
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm text-muted-foreground">Stalled workers</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {stalled.length === 0 ? (
              <li className="text-muted-foreground">No failed or stalled workers.</li>
            ) : (
              stalled.map((job) => (
                <li key={`${job.issueId}-${job.stage}`}>
                  <Link href={`/issues/${job.issueId}`}>
                    {job.stage} · {job.status}
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>
      </aside>
    </main>
  );
}
