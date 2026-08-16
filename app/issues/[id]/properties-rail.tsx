import { assignIssueAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { STAGE_LABEL, jobStatusLabel } from "@/lib/foundry/copy";
import type { Cycle, Issue, IssueJob, Module, Project } from "@/lib/foundry/types";

export function PropertiesRail({
  issue,
  job,
  project,
  cycle,
  module: mod,
  projects,
  cycles,
  modules,
}: {
  issue: Issue;
  job: IssueJob | null;
  project: Project | null;
  cycle: Cycle | null;
  module: Module | null;
  projects: Project[];
  cycles: Cycle[];
  modules: Module[];
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 border-l border-border p-4 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Stage</div>
        <div className="mt-1">{STAGE_LABEL[issue.currentStage]}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Size</div>
        <div className="mt-1">{issue.size}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Job</div>
        <div className="mt-1">{job ? jobStatusLabel(job.status) : "Idle"}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Project</div>
        <div className="mt-1">{project?.name ?? "None"}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Cycle</div>
        <div className="mt-1">{cycle?.name ?? "None"}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Module</div>
        <div className="mt-1">{mod?.name ?? "None"}</div>
      </div>
      <form action={assignIssueAction} className="flex flex-col gap-2 border-t border-border pt-4">
        <input name="id" type="hidden" value={issue.id} />
        <select className="rounded-md border border-input bg-background p-2" defaultValue={issue.projectId ?? ""} name="projectId">
          <option value="">Project</option>
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select className="rounded-md border border-input bg-background p-2" defaultValue={issue.cycleId ?? ""} name="cycleId">
          <option value="">Cycle</option>
          {cycles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select className="rounded-md border border-input bg-background p-2" defaultValue={issue.moduleId ?? ""} name="moduleId">
          <option value="">Module</option>
          {modules.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Assign
        </Button>
      </form>
    </aside>
  );
}
