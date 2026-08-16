import { Client } from "eve/client";
import type { z } from "zod";
import { eveHost } from "./eve-host";

export async function runStructured<T>(
  schema: z.ZodType<T>,
  message: string,
  timeoutMs = 180_000,
): Promise<T> {
  const host = eveHost();
  const health = await fetch(`${host}/eve/v1/health`);
  if (!health.ok) throw new Error("Foundry worker is not reachable");
  const client = new Client({ host });
  const { response } = await client.sessions.create<T>({
    message,
    outputSchema: schema,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await response.result();
  if (result.data) return schema.parse(result.data);
  if (result.message) {
    try {
      return schema.parse(JSON.parse(result.message));
    } catch {
      throw new Error("Worker finished without valid output");
    }
  }
  throw new Error("Worker finished without output");
}
