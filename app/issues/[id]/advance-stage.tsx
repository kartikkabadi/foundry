import { completeStageAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function AdvanceStage({ id }: { id: string }) {
  return (
    <form action={completeStageAction}>
      <input name="id" type="hidden" value={id} />
      <Button type="submit" variant="outline">
        Skip this stage
      </Button>
    </form>
  );
}
