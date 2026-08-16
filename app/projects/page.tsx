import { createProjectAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { listIssuesByProject, listProjects } from "@/lib/foundry/store";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const projects = listProjects();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Projects</h1>
        <p className="mt-2 text-sm text-muted-foreground">One project per target git repo. Issues live here.</p>
      </header>
      <form action={createProjectAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
        <input
          className="rounded-md border border-input bg-background p-3"
          name="name"
          placeholder="Name"
          required
        />
        <input
          className="rounded-md border border-input bg-background p-3"
          name="targetUrl"
          placeholder="https://github.com/org/repo.git"
          required
        />
        <Button className="w-fit" type="submit">
          Add project
        </Button>
      </form>
      <ul className="flex flex-col gap-2">
        {projects.length === 0 ? (
          <li className="rounded-md border border-border p-4 text-muted-foreground">
            No projects yet. Add one, or open an Issue — Foundry creates a project from the repo URL.
          </li>
        ) : (
          projects.map((project) => {
          const issues = listIssuesByProject(project.id);
          return (
            <li className="rounded-md border border-border p-4" key={project.id}>
              <div className="font-medium">{project.name}</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">{project.targetUrl}</div>
              <div className="mt-2 text-sm text-muted-foreground">{issues.length} issues</div>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {issues.length === 0 ? (
                  <li className="text-muted-foreground">No issues assigned.</li>
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
