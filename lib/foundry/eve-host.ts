import { readFileSync } from "node:fs";
import { join } from "node:path";

type Registry = {
  origin?: string;
};

export function eveHost(): string {
  const fromEnv = process.env.EVE_BASE_URL?.trim();
  if (fromEnv) return new URL(fromEnv).origin;
  const raw = readFileSync(join(process.cwd(), ".eve/next-dev-server.json"), "utf8");
  const registry = JSON.parse(raw) as Registry;
  if (!registry.origin) throw new Error("Foundry worker origin is missing");
  return new URL(registry.origin).origin;
}
