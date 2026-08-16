import { AdvanceStage } from "@/app/issues/[id]/advance-stage";
import { EventLog } from "@/app/issues/[id]/event-log";
import { GrillPanel } from "@/app/issues/[id]/grill-panel";
import { LateWalkPanel } from "@/app/issues/[id]/late-walk-panel";
import { MidWalkPanel } from "@/app/issues/[id]/mid-walk-panel";
import { PropertiesRail } from "@/app/issues/[id]/properties-rail";
import { RefreshWhile } from "@/app/issues/[id]/refresh-while";
import { ResearchPanel } from "@/app/issues/[id]/research-panel";
import { SpecPanel } from "@/app/issues/[id]/spec-panel";
import { StageHero } from "@/app/issues/[id]/stage-hero";
import { WalkStrip } from "@/app/issues/[id]/walk-strip";
import { startGrill } from "@/lib/foundry/grill";
import { readEvents } from "@/lib/foundry/log";
import { researchState, startResearch } from "@/lib/foundry/research";
import { startSpec } from "@/lib/foundry/spec";
import {
  getArtifact,
  getCycle,
  getIssue,
  getJob,
  getModule,
  getProject,
  listCycles,
  listDecisionTickets,
  listModules,
  listProjects,
} from "@/lib/foundry/store";
import { artifactKindFor, type StageId } from "@/lib/foundry/types";
import { startWalkStage } from "@/lib/foundry/walk";
import { notFound } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boot(issueId: string, stage: StageId): boolean {
  switch (stage) {
    case "research": {
      const { brief, job } = researchState(issueId);
      const shouldRun = !brief && job?.status !== "failed" && job?.status !== "stale";
      if (shouldRun) startResearch(issueId);
      return shouldRun && !brief;
    }
    case "grill": {
      const tickets = listDecisionTickets(issueId);
      const job = getJob(issueId, "grill");
      const shouldRun = tickets.length === 0 && job?.status !== "failed" && job?.status !== "stale";
      if (shouldRun) startGrill(issueId);
      return Boolean(job?.status === "running" || shouldRun);
    }
    case "spec": {
      const artifact = getArtifact(issueId, "spec_doc");
      const job = getJob(issueId, "spec");
      const shouldRun = !artifact && job?.status !== "failed" && job?.status !== "stale";
      if (shouldRun) startSpec(issueId);
      return Boolean(!artifact && (job?.status === "running" || shouldRun));
    }
    case "improve":
    case "plan_pack":
    case "council":
    case "architecture":
    case "execute":
    case "evidence":
    case "merge":
    case "hygiene": {
      const kind = artifactKindFor(stage);
      const artifact = kind ? getArtifact(issueId, kind) : null;
      const job = getJob(issueId, stage);
      const shouldRun = !artifact && job?.status !== "failed" && job?.status !== "stale";
      if (shouldRun) startWalkStage(issueId);
      return Boolean(!artifact && (job?.status === "running" || shouldRun));
    }
    case "intake":
      return false;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = getIssue(id);
  if (!loaded) notFound();
  const { issue, stages } = loaded;
  const job = getJob(id, issue.currentStage);
  const polling = boot(id, issue.currentStage);
  const { brief } = researchState(id);
  const tickets = listDecisionTickets(id);
  const spec = getArtifact(id, "spec_doc");
  const walkKind = artifactKindFor(issue.currentStage);
  const walkArtifact = walkKind ? getArtifact(id, walkKind) : null;
  const events = readEvents(id);
  const project = issue.projectId ? getProject(issue.projectId) : null;
  const cycle = issue.cycleId ? getCycle(issue.cycleId) : null;
  const mod = issue.moduleId ? getModule(issue.moduleId) : null;

  return (
    <main className="flex min-h-full">
      <RefreshWhile active={polling} />
      <div className="flex min-w-0 flex-1 flex-col gap-8 p-6">
        <StageHero
          issue={issue}
          job={job}
          unansweredTickets={tickets.filter((ticket) => !ticket.answer).length}
        />
        <WalkStrip stages={stages} />
        {issue.currentStage === "research" ? (
          <ResearchPanel brief={brief} canAdvance issueId={id} job={job} />
        ) : null}
        {issue.currentStage === "grill" ? (
          <>
            <GrillPanel issueId={id} job={job} tickets={tickets} />
            {brief ? (
              <details className="rounded-md border border-border p-4">
                <summary className="cursor-pointer text-sm text-muted-foreground">Research brief</summary>
                <div className="mt-4">
                  <ResearchPanel brief={brief} issueId={id} job={null} />
                </div>
              </details>
            ) : null}
          </>
        ) : null}
        {issue.currentStage === "spec" ? <SpecPanel artifact={spec} issueId={id} job={job} /> : null}
        {issue.currentStage === "improve" ||
        issue.currentStage === "plan_pack" ||
        issue.currentStage === "council" ||
        issue.currentStage === "architecture" ? (
          <MidWalkPanel artifact={walkArtifact} issueId={id} job={job} stage={issue.currentStage} />
        ) : null}
        {issue.currentStage === "execute" ||
        issue.currentStage === "evidence" ||
        issue.currentStage === "merge" ||
        issue.currentStage === "hygiene" ? (
          <LateWalkPanel artifact={walkArtifact} issueId={id} job={job} stage={issue.currentStage} />
        ) : null}
        <EventLog events={events} />
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">Stuck? Skip this stage</summary>
          <div className="mt-3">
            <AdvanceStage id={issue.id} />
          </div>
        </details>
      </div>
      <PropertiesRail
        cycle={cycle}
        cycles={listCycles()}
        issue={issue}
        job={job}
        module={mod}
        modules={listModules()}
        project={project}
        projects={listProjects()}
      />
    </main>
  );
}
