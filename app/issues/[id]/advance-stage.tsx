import { completeStageAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function AdvanceStage({ id }: { id: string }) {
  return (
    <form action={completeStageAction}>
      <input name="id" type="hidden" value={id} />
      <input name="confirm" type="hidden" value="1" />
      <Button type="submit" variant="outline">
        Skip this stage
      </Button>
    </form>
  );
}
