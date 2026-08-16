import { getIssue } from "@/lib/foundry/store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = getIssue(id);
  if (!loaded) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(loaded);
}
