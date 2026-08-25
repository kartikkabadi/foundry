#!/usr/bin/env tsx
/**
 * Behavioral release gates (GATES.md G23-G26 plus the release contract):
 * each section runs focused EXISTING Vitest tests and prints its marker only
 * when every run exits 0. A failing run prints `FAIL <section>` and exits
 * nonzero. The full run prints ORCHESTRATION_GATES_OK last.
 *
 *   npx tsx scripts/check-orchestration.ts            all sections
 *   npx tsx scripts/check-orchestration.ts --only X   one section
 *
 * No source-string greps, no network, no external OMP, no full suite.
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = join(ROOT, "node_modules", ".bin", "vitest");

const GATES = [
  { name: "retry", marker: "RETRY_DURABLE_OK", runs: [
    ["orchestration-execute-driver.test.ts", "retryable failure"],
    ["execute.test.ts", "durable retry"],
    ["execute.test.ts", "later successful retry"],
  ] },
  { name: "learning", marker: "EXEC_LEARNING_OK", runs: [
    ["execute-learning.test.ts"],
  ] },
  { name: "automation", marker: "IMPROVEMENT_OK", runs: [
    ["improvement-loop.test.ts"],
  ] },
  { name: "unattended", marker: "UNATTENDED_OK", runs: [
    ["unattended.test.ts"],
    ["automation.test.ts", "never selects merge or hygiene"],
  ] },
  { name: "fencing", marker: "FENCING_OK", runs: [
    ["orchestration-store.test.ts", "leases"],
    ["orchestration-execute-driver.test.ts", "unrecoverable fence"],
    ["orchestration-execute-driver.test.ts", "stale expired lease"],
  ] },
  { name: "waiting", marker: "OUTER_RELEASE_OK", runs: [
    ["orchestration-store.test.ts", "dependency unblocking"],
    ["scheduler.test.ts", "dispatches a task once every dependency has succeeded"],
  ] },
  { name: "execution", marker: "LOCAL_EXECUTE_OK", runs: [
    ["execute.test.ts", "generates a local-only execute result with no git push or gh publication"],
  ] },
];

function vitest(file: string, filter?: string): void {
  const args = ["run", join("tests", file), ...(filter ? ["-t", filter] : [])];
  const result = spawnSync(VITEST, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw new Error(`vitest: ${result.error.message}`);
  if (result.status !== 0) {
    const tail = (result.stdout ?? "").split("\n").slice(-30).join("\n");
    throw new Error(`${file}${filter ? ` -t "${filter}"` : ""} exited ${result.status}\n${tail}`);
  }
}

function main(): void {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
  const selected = GATES.filter((gate) => !only || gate.name === only);
  if (only && selected.length === 0) {
    console.error(`FAIL: unknown section "${only}" (available: ${GATES.map((g) => g.name).join(", ")})`);
    process.exitCode = 1;
    return;
  }
  let failed = false;
  for (const gate of selected) {
    try {
      for (const [file, filter] of gate.runs) vitest(file, filter);
      console.log(gate.marker);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${gate.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!failed && !only) console.log("ORCHESTRATION_GATES_OK");
}

main();
