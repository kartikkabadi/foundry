import { Client } from "eve/client";
import type { z } from "zod";
import { withWorkerSlot } from "./concurrency";
import { withHeartbeat } from "./heartbeat";
import { eveHost } from "./eve-host";
import type { StageId } from "./types";

export async function runStructured<T>(
  schema: z.ZodType<T>,
  message: string,
  options?: { timeoutMs?: number; issueId?: string; stage?: StageId },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 36_000_000;
  return withHeartbeat(
    options?.issueId ?? null,
    options?.stage ?? null,
    withWorkerSlot(async () => {
      const client = new Client({ host: eveHost() });
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
    }),
  );
}
