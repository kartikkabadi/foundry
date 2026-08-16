import { createIssueAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { Cycle, IssueSize, Module, Project } from "@/lib/foundry/types";

const SIZES: IssueSize[] = ["xs", "s", "m", "l", "forced_l"];

export function IntakeForm({
  projects,
  cycles,
  modules,
}: {
  projects: Project[];
  cycles: Cycle[];
  modules: Module[];
}) {
  return (
    <form action={createIssueAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-foreground">What do you want built?</span>
        <textarea
          className="min-h-28 rounded-md border border-input bg-background p-3 text-base text-foreground outline-none focus-visible:border-ring"
          name="idea"
          placeholder="Describe the change in plain language."
          required
        />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-foreground">Repo</span>
        <input
          className="rounded-md border border-input bg-background p-3 text-foreground outline-none focus-visible:border-ring"
          defaultValue="https://github.com/kartikkabadi/foundry.git"
          name="targetUrl"
          required
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-foreground">How far to run</span>
          <select
            className="rounded-md border border-input bg-background p-3 text-foreground"
            defaultValue="forced_l"
            name="size"
          >
            {SIZES.map((value) => (
              <option key={value} value={value}>
                {value === "forced_l" ? "forced-L — every stage, no skips" : value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-foreground">Project</span>
          <select className="rounded-md border border-input bg-background p-3 text-foreground" name="projectId">
            <option value="">From repo URL</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-foreground">Cycle</span>
          <select className="rounded-md border border-input bg-background p-3 text-foreground" name="cycleId">
            <option value="">None</option>
            {cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-foreground">Module</span>
          <select className="rounded-md border border-input bg-background p-3 text-foreground" name="moduleId">
            <option value="">None</option>
            {modules.map((mod) => (
              <option key={mod.id} value={mod.id}>
                {mod.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Button className="w-fit" type="submit">
        Open issue
      </Button>
    </form>
  );
}
