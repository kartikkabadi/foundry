import { STALE_JOB_MS } from "../lib/foundry/types";
import {
  assignIssue,
  createCycle,
  createIssue,
  createModule,
  createProject,
  getJob,
  listCycles,
  listIssuesByCycle,
  listIssuesByModule,
  listIssuesByProject,
  listModules,
  listProjects,
  reconcileStaleJobs,
  tryClaimJob,
} from "../lib/foundry/store";

process.env.FOUNDRY_DATA = `/tmp/foundry-features-${process.pid}`;

const project = createProject({
  name: "foundry",
  targetUrl: "https://github.com/kartikkabadi/foundry.git",
});
const cycle = createCycle({
  name: "Week 1",
  startsAt: "2026-08-17",
  endsAt: "2026-08-24",
  status: "active",
});
const mod = createModule({ projectId: project.id, name: "Dashboard" });
const issue = createIssue({
  idea: "Ship the operator dashboard",
  targetUrl: project.targetUrl,
  size: "forced_l",
  projectId: project.id,
  cycleId: cycle.id,
  moduleId: mod.id,
});
assignIssue(issue.id, { projectId: project.id, cycleId: cycle.id, moduleId: mod.id });

if (listProjects().length < 1) throw new Error("no projects");
if (listCycles().length < 1) throw new Error("no cycles");
if (listModules().length < 1) throw new Error("no modules");
if (listIssuesByProject(project.id).length < 1) throw new Error("project has no issues");
if (listIssuesByCycle(cycle.id).length < 1) throw new Error("cycle has no issues");
if (listIssuesByModule(mod.id).length < 1) throw new Error("module has no issues");

const old = new Date(Date.now() - STALE_JOB_MS - 1000).toISOString();
tryClaimJob(issue.id, "research", old);
const marked = reconcileStaleJobs(STALE_JOB_MS);
if (marked < 1) throw new Error("stale job not marked");
const job = getJob(issue.id, "research");
if (job?.status !== "stale") throw new Error(`expected stale, got ${job?.status}`);

console.log("FEATURES_OK", project.id, cycle.id, mod.id, issue.id);
