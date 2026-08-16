import { STAGE_LABEL, stageTone } from "@/lib/foundry/copy";
import { STAGES, type IssueStage } from "@/lib/foundry/types";

export function WalkStrip({ stages }: { stages: IssueStage[] }) {
  const byId = new Map(stages.map((stage) => [stage.stage, stage]));
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {STAGES.map((id) => {
        const row = byId.get(id);
        const status = row?.status ?? "pending";
        return (
          <li className={stageTone(status)} key={id}>
            {STAGE_LABEL[id]}
            {status === "active" ? " · now" : null}
          </li>
        );
      })}
    </ol>
  );
}
