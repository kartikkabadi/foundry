"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdvanceStage({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="w-fit border border-neutral-200 px-3 py-2 text-sm text-black bg-neutral-100 disabled:opacity-50"
      disabled={busy}
      type="button"
      onClick={async () => {
        setBusy(true);
        await fetch("/api/issues", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        setBusy(false);
        router.refresh();
      }}
    >
      Complete current stage
    </button>
  );
}
