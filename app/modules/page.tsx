import { createModuleAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { listIssuesByModule, listModules, listProjects } from "@/lib/foundry/store";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ModulesPage() {
  const modules = listModules();
  const projects = listProjects();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Modules</h1>
        <p className="mt-2 text-sm text-muted-foreground">Capability buckets on a project. Issues can be assigned.</p>
      </header>
      <form action={createModuleAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
        <select className="rounded-md border border-input bg-background p-3" name="projectId" required>
          <option value="">Project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <input className="rounded-md border border-input bg-background p-3" name="name" placeholder="Module name" required />
        <Button className="w-fit" type="submit">
          Add module
        </Button>
      </form>
      <ul className="flex flex-col gap-2">
        {modules.length === 0 ? (
          <li className="rounded-md border border-border p-4 text-muted-foreground">
            {projects.length === 0
              ? "No modules yet. Add a project first, then a capability bucket."
              : "No modules yet. Add a capability bucket on a project, then assign Issues."}
          </li>
        ) : (
          modules.map((mod) => {
          const issues = listIssuesByModule(mod.id);
          const project = projects.find((item) => item.id === mod.projectId);
          return (
            <li className="rounded-md border border-border p-4" key={mod.id}>
              <div className="font-medium">{mod.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{project?.name ?? "Unknown project"}</div>
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
