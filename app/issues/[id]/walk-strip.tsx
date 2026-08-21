import { CheckIcon, CircleIcon, MinusIcon } from "lucide-react";
import { STAGE_LABEL, stageTone } from "@/lib/foundry/copy";
import { STAGES, type IssueStage, type StageStatus } from "@/lib/foundry/types";

type MarkerStatus = "done" | "skipped" | "active" | "pending";

const STATUS_WORD: Record<MarkerStatus, string> = {
  done: "completed",
  skipped: "skipped",
  active: "in progress",
  pending: "pending",
};

function toMarkerStatus(status: StageStatus): MarkerStatus {
  switch (status) {
    case "done":
    case "skipped":
    case "active":
    case "pending":
      return status;
    default: {
      console.warn(
        `[foundry:walk-strip] unrecognized stage status "${String(status)}"; clamping to pending`,
      );
      return "pending";
    }
  }
}

function MarkerGlyph({ status }: { status: MarkerStatus }) {
  switch (status) {
    case "done":
      return <CheckIcon aria-hidden="true" className="size-3 text-emerald-300" />;
    case "skipped":
      return <MinusIcon aria-hidden="true" className="size-3 text-neutral-600" />;
    case "active":
      return <CircleIcon aria-hidden="true" className="size-3 text-primary" fill="currentColor" />;
    case "pending":
      return <CircleIcon aria-hidden="true" className="size-3 text-neutral-600" />;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function WalkStrip({ stages }: { stages: IssueStage[] }) {
  const byId = new Map(stages.map((stage) => [stage.stage, stage]));
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {STAGES.map((id, index) => {
        const row = byId.get(id);
        const status = toMarkerStatus(row?.status ?? "pending");
        const name = STAGE_LABEL[id] ?? `Stage ${index + 1}`;
        return (
          <li className={`inline-flex items-center gap-1 ${stageTone(status)}`} key={id}>
            <span
              aria-label={`${name}: ${STATUS_WORD[status]}`}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
              role="img"
            >
              <MarkerGlyph status={status} />
            </span>
            {name}
          </li>
        );
      })}
    </ol>
  );
}
