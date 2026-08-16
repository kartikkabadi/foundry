import { skippedStages } from "../lib/foundry/types";
import { createIssue, getIssue } from "../lib/foundry/store";

const forced = skippedStages("forced_l");
if (Object.keys(forced).length !== 0) {
  throw new Error(`forced_l must skip nothing, got ${JSON.stringify(forced)}`);
}
process.env.FOUNDRY_DATA = "/tmp/foundry-gate-data";
const issue = createIssue({
  idea: "Write CONTEXT.md",
  targetUrl: "https://github.com/kartikkabadi/foundry.git",
  size: "forced_l",
});
const loaded = getIssue(issue.id);
if (!loaded) throw new Error("missing issue");
const skipped = loaded.stages.filter((stage) => stage.status === "skipped");
if (skipped.length !== 0) {
  throw new Error(`forced_l skipped ${skipped.map((stage) => stage.stage).join(",")}`);
}
const council = loaded.stages.find((stage) => stage.stage === "council");
const architecture = loaded.stages.find((stage) => stage.stage === "architecture");
if (council?.status === "skipped" || architecture?.status === "skipped") {
  throw new Error("council/architecture skipped on forced_l");
}
console.log("WALK_OK", issue.id, loaded.issue.currentStage);
