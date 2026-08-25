import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The panel routes through Next server actions and UI primitives that pull in
// Next/radix chains that do not load in a Node test env. Stub them to plain
// DOM so the component's own logic is exercised.
vi.mock("@/app/actions", () => ({
  completeStageAction: undefined,
  retryStageAction: undefined,
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: { children?: ReactNode }) =>
    createElement("button", { type: "button" }, props.children ?? null),
}));
vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

import type { IssueArtifact, StageId } from "@/lib/foundry/types";
import { WalkDocPanel } from "../app/issues/[id]/walk-doc-panel";

function executeArtifact(overrides: { prUrl: string; branchName?: string }): IssueArtifact {
  return {
    issueId: "issue-1",
    kind: "execute_log",
    stage: "execute" as StageId,
    createdAt: new Date().toISOString(),
    body: JSON.stringify({
      prUrl: overrides.prUrl,
      branchName: overrides.branchName ?? "foundry/test-branch",
      commitMessage: "test commit",
      diff: "--- a/hello.txt\n+++ b/hello.txt\n+hello world",
      testResults: "tests passed",
      filesChanged: ["hello.txt"],
    }),
  };
}

function renderPanel(artifact: IssueArtifact): string {
  return renderToStaticMarkup(
    createElement(WalkDocPanel, { stage: "execute", artifact, job: null, issueId: "issue-1" }),
  );
}

describe("WalkDocPanel execute result wording", () => {
  it("labels a local-only build and omits the PR link when prUrl is empty", () => {
    const html = renderPanel(executeArtifact({ prUrl: "" }));

    // Truthful heading for a local build artifact.
    expect(html).toContain("Local Build Ready");
    expect(html).not.toContain("Pull Request Created");
    // No dead link to the current page.
    expect(html).not.toContain('href=""');
    expect(html).not.toContain('<a ');
    // The local branch/commit are still shown.
    expect(html).toContain("Branch: foundry/test-branch");
    expect(html).toContain("Commit: test commit");
  });

  it("keeps the PR heading and link only when prUrl is present", () => {
    const prUrl = "https://github.com/kartikkabadi/foundry/pull/42";
    const html = renderPanel(executeArtifact({ prUrl }));

    expect(html).toContain("Pull Request Created");
    expect(html).not.toContain("Local Build Ready");
    expect(html).toContain(`href="${prUrl}"`);
    expect(html).toContain("Branch: foundry/test-branch");
    expect(html).toContain("Commit: test commit");
  });
});
