import { describe, expect, it } from "vitest";
import {
  decidePublicationStep,
  parseLsRemote,
  planPublication,
  publish,
  pushArgv,
  runPublication,
  type BranchState,
  type DiscoveredState,
  type PrState,
  type PublishGrant,
  type PublicationEffects,
  type PublicationEvent,
  type PublicationInput,
  type PublicationPlan,
} from "../lib/foundry/publication";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeGrant(overrides: Partial<PublishGrant> = {}): PublishGrant {
  return {
    operator: "operator",
    grantedAt: "2026-08-25T00:00:00.000Z",
    scope: { owner: "kartikkabadi", repo: "foundry" },
    actions: ["push", "pr"],
    nonce: "nonce-1",
    ...overrides,
  };
}

function makeInput(overrides: Partial<PublicationInput> = {}): PublicationInput {
  return {
    repo: { owner: "kartikkabadi", repo: "foundry" },
    branch: "agent/autonomy-publication",
    headSha: HEAD,
    base: "main",
    title: "Autonomy publication",
    body: "Push verified head and open PR.",
    remote: "origin",
    intent: "publish",
    evidence: {
      verdict: "passed",
      headSha: HEAD,
      artifacts: ["verify.log"],
      verifiedAt: "2026-08-25T00:00:00.000Z",
      verifier: "independent",
    },
    workspace: { headSha: HEAD, clean: true, checkedAt: "2026-08-25T00:00:00.000Z" },
    authority: { kind: "granted", grant: makeGrant() },
    ...overrides,
  };
}

/** Plan a valid request, throwing if the planner rejects it. */
function planOf(overrides: Partial<PublicationInput> = {}): PublicationPlan {
  const result = planPublication(makeInput(overrides));
  if (!result.ok) throw new Error(`plan rejected: ${result.code} ${result.reason}`);
  return result;
}

type MutableState = { branch: BranchState; pr: PrState };

function makeState(overrides: Partial<MutableState> = {}): MutableState {
  return { branch: { kind: "missing" }, pr: { kind: "missing" }, ...overrides };
}

/** Stateful fake git exec: push moves the branch, discovery reads the state. */
function defaultRun(state: MutableState, headSha: string): PublicationEffects["run"] {
  return async (argv) => {
    if (argv[1] === "ls-remote") {
      const branch = argv[4];
      return {
        stdout: state.branch.kind === "exists" ? `${state.branch.headSha}\trefs/heads/${branch}\n` : "",
        stderr: "",
      };
    }
    if (argv[1] === "rev-parse") return { stdout: `${headSha}\n`, stderr: "" };
    if (argv[1] === "status") return { stdout: "", stderr: "" };
    if (argv[1] === "push") {
      state.branch = { kind: "exists", headSha };
      return { stdout: "", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
}

function makeEffects(
  state: MutableState,
  headSha: string = HEAD,
  overrides: Partial<PublicationEffects> = {},
): PublicationEffects {
  return {
    run: defaultRun(state, headSha),
    getPr: async () => state.pr,
    createPr: async (input) => {
      state.pr = {
        kind: "exists",
        number: 7,
        headSha: input.headSha,
        base: input.base,
        title: input.title,
        body: input.body,
      };
      return { number: 7 };
    },
    updatePr: async (input) => {
      state.pr = {
        kind: "exists",
        number: input.number,
        headSha: input.headSha,
        base: input.base,
        title: input.title,
        body: input.body,
      };
      return { number: input.number };
    },
    ...overrides,
  };
}

function mutationKinds(events: readonly PublicationEvent[]): string[] {
  return events
    .filter((e) => e.kind === "push" || e.kind === "create-pr" || e.kind === "update-pr")
    .map((e) => e.kind);
}

// ---------------------------------------------------------------------------
// planPublication: validation
// ---------------------------------------------------------------------------

describe("planPublication", () => {
  it("accepts a valid request and produces a frozen publish plan", () => {
    const plan = planOf();
    expect(plan.intent).toBe("publish");
    expect(plan.headSha).toBe(HEAD);
    expect(plan.branch).toBe("agent/autonomy-publication");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.evidence)).toBe(true);
    expect(Object.isFrozen(plan.workspace)).toBe(true);
    expect(Object.isFrozen(plan.authority)).toBe(true);
    expect(Object.isFrozen(plan.authority.scope)).toBe(true);
    expect(Object.isFrozen(plan.authority.actions)).toBe(true);
  });

  it.each([
    "main",
    "feature/x",
    "agent/",
    "agent/a..b",
    "agent/a.lock",
    "agent/a.",
    "agent/a b",
    "agent//x",
    "agent/../x",
    "agent/a@b",
    "agent/a~b",
  ])("rejects invalid branch namespace %j", (branch) => {
    const result = planPublication(makeInput({ branch }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-branch");
  });

  it.each(["not-a-sha", "ABC", "a".repeat(39), "a".repeat(41), "a".repeat(65), "A".repeat(40)])(
    "rejects malformed headSha %j",
    (headSha) => {
      const result = planPublication(makeInput({ headSha }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid-head-sha");
    },
  );

  it("rejects a failed verification verdict", () => {
    const result = planPublication(
      makeInput({ evidence: { ...makeInput().evidence, verdict: "failed" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("evidence-verdict-failed");
  });

  it("rejects verification evidence bound to a different SHA", () => {
    const result = planPublication(
      makeInput({ evidence: { ...makeInput().evidence, headSha: OTHER } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("evidence-sha-mismatch");
  });

  it("rejects verification evidence with no artifacts", () => {
    const result = planPublication(
      makeInput({ evidence: { ...makeInput().evidence, artifacts: [] } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-evidence");
  });

  it("rejects a dirty workspace", () => {
    const result = planPublication(
      makeInput({ workspace: { ...makeInput().workspace, clean: false } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("dirty-workspace");
  });

  it("rejects clean-workspace evidence bound to a different SHA", () => {
    const result = planPublication(
      makeInput({ workspace: { ...makeInput().workspace, headSha: OTHER } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("workspace-sha-mismatch");
  });

  it("rejects absent authority", () => {
    const result = planPublication(
      makeInput({ authority: { kind: "absent", reason: "no grant on file" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("authority-not-granted");
  });

  it("rejects revoked authority", () => {
    const result = planPublication(
      makeInput({ authority: { kind: "revoked", reason: "revoked by operator" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("authority-not-granted");
  });

  it("rejects authority scoped to a different repository", () => {
    const result = planPublication(
      makeInput({
        authority: { kind: "granted", grant: makeGrant({ scope: { owner: "other", repo: "other" } }) },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("authority-scope-mismatch");
  });

  it("rejects authority that does not grant push", () => {
    const result = planPublication(
      makeInput({ authority: { kind: "granted", grant: makeGrant({ actions: ["pr"] }) } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("authority-action-not-granted");
  });

  it("rejects authority that does not grant pr", () => {
    const result = planPublication(
      makeInput({ authority: { kind: "granted", grant: makeGrant({ actions: ["push"] }) } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("authority-action-not-granted");
  });

  it("rejects merge and deploy intent", () => {
    for (const intent of ["merge", "deploy"] as const) {
      const result = planPublication(makeInput({ intent }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("merge-or-deploy-intent");
    }
  });

  it("rejects an invalid repository identity", () => {
    const result = planPublication(makeInput({ repo: { owner: "", repo: "foundry" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-repo");
  });

  it("rejects an empty remote", () => {
    const result = planPublication(makeInput({ remote: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-remote");
  });

  it("rejects an empty PR title", () => {
    const result = planPublication(makeInput({ title: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-pr-content");
  });
});

// ---------------------------------------------------------------------------
// decidePublicationStep: pure decision matrix
// ---------------------------------------------------------------------------

describe("decidePublicationStep", () => {
  const plan = planOf();
  const matchingPr = {
    kind: "exists",
    number: 7,
    headSha: HEAD,
    base: "main",
    title: "Autonomy publication",
    body: "Push verified head and open PR.",
  } as const;

  it("pushes when the remote branch is missing", () => {
    const decision = decidePublicationStep(plan, {
      branch: { kind: "missing" },
      pr: { kind: "missing" },
    });
    expect(decision).toEqual({ kind: "push" });
  });

  it("creates the PR when the branch is at the verified SHA and no PR exists", () => {
    const decision = decidePublicationStep(plan, {
      branch: { kind: "exists", headSha: HEAD },
      pr: { kind: "missing" },
    });
    expect(decision).toEqual({ kind: "create-pr" });
  });

  it("is done when the branch and PR both match the plan (idempotent)", () => {
    const decision = decidePublicationStep(plan, {
      branch: { kind: "exists", headSha: HEAD },
      pr: matchingPr,
    });
    expect(decision).toEqual({ kind: "done", prNumber: 7 });
  });

  it("updates (not creates) the PR when only content differs", () => {
    const decision = decidePublicationStep(plan, {
      branch: { kind: "exists", headSha: HEAD },
      pr: { ...matchingPr, title: "Stale title" },
    });
    expect(decision).toEqual({ kind: "update-pr", number: 7 });
  });

  it("rejects when the remote branch is at a different SHA (force push required)", () => {
    const decision = decidePublicationStep(plan, {
      branch: { kind: "exists", headSha: OTHER },
      pr: { kind: "missing" },
    });
    expect(decision.kind).toBe("reject");
    if (decision.kind === "reject") expect(decision.reason).toContain("force push");
  });

  it("rejects when the PR head diverged from the verified SHA", () => {
    const decision = decidePublicationStep(plan, {
      branch: { kind: "exists", headSha: HEAD },
      pr: { ...matchingPr, headSha: OTHER },
    });
    expect(decision.kind).toBe("reject");
  });
});

// ---------------------------------------------------------------------------
// parseLsRemote
// ---------------------------------------------------------------------------

describe("parseLsRemote", () => {
  it("returns missing for empty output", () => {
    expect(parseLsRemote("", "agent/x")).toEqual({ kind: "missing" });
  });

  it("returns missing when the ref is absent", () => {
    const stdout = `${OTHER}\trefs/heads/main\n`;
    expect(parseLsRemote(stdout, "agent/x")).toEqual({ kind: "missing" });
  });

  it("returns the SHA for a matching ref", () => {
    expect(parseLsRemote(`${HEAD}\trefs/heads/agent/x\n`, "agent/x")).toEqual({
      kind: "exists",
      headSha: HEAD,
    });
  });

  it("ignores unrelated lines and picks the matching ref", () => {
    const stdout = `${OTHER}\trefs/heads/main\n${HEAD}\trefs/heads/agent/x\n${OTHER}\trefs/heads/agent/y\n`;
    expect(parseLsRemote(stdout, "agent/x")).toEqual({ kind: "exists", headSha: HEAD });
  });
});

// ---------------------------------------------------------------------------
// runPublication: driver behavior
// ---------------------------------------------------------------------------

describe("runPublication", () => {
  it("pushes then creates the PR on a fresh publish", async () => {
    const state = makeState();
    const result = await runPublication(planOf(), makeEffects(state));
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.prNumber).toBe(7);
    expect(result.retries).toBe(0);
    expect(mutationKinds(result.events)).toEqual(["push", "create-pr"]);
    const pushEvent = result.events.find(
      (e): e is Extract<PublicationEvent, { kind: "push" }> => e.kind === "push",
    );
    expect(pushEvent?.argv).toEqual([
      "git",
      "push",
      "origin",
      `${HEAD}:refs/heads/agent/autonomy-publication`,
    ]);
    expect(pushEvent?.argv).not.toContain("--force");
    expect(pushEvent?.argv).not.toContain("-f");
    expect(pushEvent?.argv).not.toContain("--force-with-lease");
  });

  it("binds the exact verified SHA in the push refspec (detached HEAD, stale local branch)", async () => {
    // The workspace is a detached HEAD at the verified SHA (the pre-push
    // guard passes), but a stale local branch ref at a different SHA exists.
    // The push must target `<headSha>:refs/heads/<branch>`, never the stale
    // local branch ref by name.
    const state = makeState();
    const pushArgvs: string[][] = [];
    const effects = makeEffects(state, HEAD, {
      run: async (argv) => {
        if (argv[1] === "push") pushArgvs.push(argv);
        return defaultRun(state, HEAD)(argv);
      },
    });
    const result = await runPublication(planOf(), effects);
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(pushArgvs).toEqual([
      ["git", "push", "origin", `${HEAD}:refs/heads/agent/autonomy-publication`],
    ]);
    expect(pushArgvs[0]).not.toContain("--force");
    expect(pushArgvs[0]).not.toContain("-f");
  });

  it("creates the PR without re-pushing when the branch is already at the verified SHA", async () => {
    const state = makeState({ branch: { kind: "exists", headSha: HEAD } });
    const result = await runPublication(planOf(), makeEffects(state));
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(mutationKinds(result.events)).toEqual(["create-pr"]);
    expect(result.prNumber).toBe(7);
  });

  it("issues zero mutations when the branch and PR already match (idempotent re-run)", async () => {
    const state = makeState({
      branch: { kind: "exists", headSha: HEAD },
      pr: {
        kind: "exists",
        number: 7,
        headSha: HEAD,
        base: "main",
        title: "Autonomy publication",
        body: "Push verified head and open PR.",
      },
    });
    const result = await runPublication(planOf(), makeEffects(state));
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(mutationKinds(result.events)).toEqual([]);
    expect(result.prNumber).toBe(7);
  });

  it("updates (not creates) a PR whose content differs", async () => {
    const state = makeState({
      branch: { kind: "exists", headSha: HEAD },
      pr: { kind: "exists", number: 7, headSha: HEAD, base: "main", title: "Stale title", body: "old" },
    });
    const result = await runPublication(planOf(), makeEffects(state));
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(mutationKinds(result.events)).toEqual(["update-pr"]);
    expect(result.prNumber).toBe(7);
  });

  it("retries after a partial push without re-pushing", async () => {
    const state = makeState();
    let pushCalls = 0;
    const effects = makeEffects(state, HEAD, {
      run: async (argv) => {
        if (argv[1] === "push") {
          pushCalls += 1;
          state.branch = { kind: "exists", headSha: HEAD }; // remote moved, then the call errored
          throw new Error("connection dropped after ref update");
        }
        return defaultRun(state, HEAD)(argv);
      },
    });
    const result = await runPublication(planOf(), effects);
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(pushCalls).toBe(1); // attempted exactly once, never re-applied
    expect(result.prNumber).toBe(7);
    expect(result.retries).toBe(1);
    // Only completed mutations are recorded; the thrown push leaves no event.
    expect(mutationKinds(result.events)).toEqual(["create-pr"]);
  });

  it("retries a transient create-pr failure", async () => {
    const state = makeState({ branch: { kind: "exists", headSha: HEAD } });
    let createCalls = 0;
    const effects = makeEffects(state, HEAD, {
      createPr: async (input) => {
        createCalls += 1;
        if (createCalls === 1) throw new Error("network error");
        state.pr = {
          kind: "exists",
          number: 7,
          headSha: input.headSha,
          base: input.base,
          title: input.title,
          body: input.body,
        };
        return { number: 7 };
      },
    });
    const result = await runPublication(planOf(), effects);
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(createCalls).toBe(2);
    expect(result.retries).toBe(1);
  });

  it("fails after exhausting retries on a persistently failing effect", async () => {
    const state = makeState({ branch: { kind: "exists", headSha: HEAD } });
    const effects = makeEffects(state, HEAD, {
      createPr: async () => {
        throw new Error("still down");
      },
    });
    const result = await runPublication(planOf(), effects, { maxAttempts: 2 });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.retryable).toBe(true);
    expect(result.retries).toBe(2);
  });

  it("rejects at push time when the local HEAD is not the verified SHA", async () => {
    const state = makeState();
    const effects = makeEffects(state, HEAD, {
      run: async (argv) => {
        if (argv[1] === "rev-parse") return { stdout: `${OTHER}\n`, stderr: "" };
        return defaultRun(state, HEAD)(argv);
      },
    });
    const result = await runPublication(planOf(), effects);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("not the verified head");
  });

  it("rejects at push time when the workspace is dirty", async () => {
    const state = makeState();
    const effects = makeEffects(state, HEAD, {
      run: async (argv) => {
        if (argv[1] === "status") return { stdout: " M lib/x.ts\n", stderr: "" };
        return defaultRun(state, HEAD)(argv);
      },
    });
    const result = await runPublication(planOf(), effects);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("dirty");
  });

  it("rejects after push when the remote branch lands on a different SHA", async () => {
    const state = makeState();
    const effects = makeEffects(state, HEAD, {
      run: async (argv) => {
        if (argv[1] === "push") {
          state.branch = { kind: "exists", headSha: OTHER }; // remote moved somewhere else
          return { stdout: "", stderr: "" };
        }
        return defaultRun(state, HEAD)(argv);
      },
    });
    const result = await runPublication(planOf(), effects);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("force push");
  });

  it("rejects without pushing when the remote branch is already at a different SHA", async () => {
    const state = makeState({ branch: { kind: "exists", headSha: OTHER } });
    let pushCalls = 0;
    const effects = makeEffects(state, HEAD, {
      run: async (argv) => {
        if (argv[1] === "push") pushCalls += 1;
        return defaultRun(state, HEAD)(argv);
      },
    });
    const result = await runPublication(planOf(), effects);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.retryable).toBe(false);
    expect(pushCalls).toBe(0);
  });

  it("fails closed when a push succeeds but discovery still reports the branch missing", async () => {
    const state = makeState();
    let pushCalls = 0;
    const effects = makeEffects(state, HEAD, {
      run: async (argv) => {
        if (argv[1] === "push") {
          pushCalls += 1;
          return { stdout: "", stderr: "" }; // success, but state never becomes visible
        }
        return defaultRun(state, HEAD)(argv);
      },
    });
    const result = await runPublication(planOf(), effects);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("duplicate push");
    expect(pushCalls).toBe(1);
  });

  it("fails closed when a create-pr succeeds but discovery still reports the PR missing", async () => {
    const state = makeState({ branch: { kind: "exists", headSha: HEAD } });
    let createCalls = 0;
    const effects = makeEffects(state, HEAD, {
      createPr: async () => {
        createCalls += 1;
        return { number: 7 }; // success, but state never becomes visible
      },
    });
    const result = await runPublication(planOf(), effects);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("duplicate create-pr");
    expect(createCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// No force push / no merge-deploy (structural)
// ---------------------------------------------------------------------------

describe("publication safety surface", () => {
  it("never builds a force push argv and always pins the exact SHA in the refspec", () => {
    for (const branch of ["agent/a", "agent/b", "agent/c"]) {
      const argv = pushArgv("origin", branch, HEAD);
      expect(argv).not.toContain("--force");
      expect(argv).not.toContain("-f");
      expect(argv).not.toContain("--force-with-lease");
      expect(argv[0]).toBe("git");
      expect(argv[1]).toBe("push");
      expect(argv[3]).toBe(`${HEAD}:refs/heads/${branch}`);
    }
  });

  it("only ever mutates via push/create-pr/update-pr, never merge or deploy", async () => {
    const state = makeState();
    const result = await runPublication(planOf(), makeEffects(state));
    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(mutationKinds(result.events)).toEqual(["push", "create-pr"]);
  });
});

// ---------------------------------------------------------------------------
// publish: combined entry point
// ---------------------------------------------------------------------------

describe("publish", () => {
  it("returns a rejection without invoking effects for merge intent", async () => {
    let invoked = false;
    const effects = makeEffects(makeState());
    const outcome = await publish(makeInput({ intent: "merge" }), {
      ...effects,
      run: async () => {
        invoked = true;
        return { stdout: "", stderr: "" };
      },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.rejection.code).toBe("merge-or-deploy-intent");
    expect(invoked).toBe(false);
  });

  it("plans and drives a valid request", async () => {
    const outcome = await publish(makeInput(), makeEffects(makeState()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("published");
  });
});

// ---------------------------------------------------------------------------
// Input immutability
// ---------------------------------------------------------------------------

describe("input immutability", () => {
  it("does not mutate its input and returns a deeply frozen plan", async () => {
    const input = makeInput();
    const snapshot = structuredClone(input);
    const planResult = planPublication(input);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    const plan = planResult;
    await runPublication(plan, makeEffects(makeState()));
    expect(input).toEqual(snapshot);
  });

  it("does not mutate the plan while driving", async () => {
    const plan = planOf();
    const snapshot = structuredClone(plan);
    await runPublication(plan, makeEffects(makeState()));
    expect(plan).toEqual(snapshot);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.headSha).toBe(HEAD);
  });
});
