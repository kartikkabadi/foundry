import { retryResearchAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function RetryResearch({ id }: { id: string }) {
  return (
    <form action={retryResearchAction}>
      <input name="id" type="hidden" value={id} />
      <Button type="submit">Run research again</Button>
    </form>
  );
}
