"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Issue, IssueSize } from "@/lib/foundry/types";

const SIZES: IssueSize[] = ["xs", "s", "m", "l", "forced_l"];

export function IntakeForm() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [targetUrl, setTargetUrl] = useState("https://github.com/kartikkabadi/foundry.git");
  const [size, setSize] = useState<IssueSize>("forced_l");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex max-w-2xl flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const response = await fetch("/api/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea, targetUrl, size }),
        });
        const body = (await response.json()) as { issue?: Issue; error?: string };
        setBusy(false);
        if (!response.ok || !body.issue) {
          setError(body.error ?? "create failed");
          return;
        }
        router.push(`/issues/${body.issue.id}`);
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Idea
        <textarea
          className="min-h-28 border border-neutral-700 bg-black p-2"
          value={idea}
          onChange={(event) => setIdea(event.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Target git URL
        <input
          className="border border-neutral-700 bg-black p-2"
          value={targetUrl}
          onChange={(event) => setTargetUrl(event.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Size
        <select
          className="border border-neutral-700 bg-black p-2"
          value={size}
          onChange={(event) => setSize(event.target.value as IssueSize)}
        >
          {SIZES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button className="w-fit bg-neutral-100 px-3 py-2 text-sm text-black disabled:opacity-50" disabled={busy} type="submit">
        Open Issue
      </button>
    </form>
  );
}
