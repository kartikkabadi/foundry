import { createIssue, getArtifact, getIssue, saveArtifact } from "../lib/foundry/store";
import { parseResearchBrief } from "../lib/foundry/research";

process.env.FOUNDRY_DATA = "/tmp/foundry-research-store";

const issue = createIssue({
  idea: "Clarify the Issue page",
  targetUrl: "https://github.com/kartikkabadi/foundry.git",
  size: "forced_l",
});

saveArtifact({
  issueId: issue.id,
  kind: "research_brief",
  stage: "research",
  body: JSON.stringify({
    inPlainEnglish: "Make the Issue page readable.",
    whatTheRepoIs: "Foundry dashboard.",
    whatThisIdeaWouldChange: "Replace the graph with the current stage.",
    constraints: ["Human gates stay in the dashboard"],
    risks: ["Empty pages look like a broken app"],
    questionsForYou: ["What should the operator see first?"],
  }),
});

const artifact = getArtifact(issue.id, "research_brief");
if (!artifact) throw new Error("missing artifact");
const brief = parseResearchBrief(artifact.body);
if (!brief || brief.questionsForYou.length !== 1) {
  throw new Error("brief roundtrip failed");
}
const loaded = getIssue(issue.id);
if (!loaded) throw new Error("missing issue");
console.log("RESEARCH_STORE_OK", issue.id);
