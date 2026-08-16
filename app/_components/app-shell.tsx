import { CommandMenu } from "@/app/_components/command-menu";
import { Sidebar } from "@/app/_components/sidebar";
import type { NavCounts } from "@/lib/foundry/types";
import type { ReactNode } from "react";

export function AppShell({
  children,
  issues,
  counts,
}: {
  children: ReactNode;
  issues: Array<{ id: string; idea: string }>;
  counts: NavCounts;
}) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar counts={counts} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 items-center justify-between border-b border-border px-4">
          <p className="text-sm text-muted-foreground">Human-in-the-loop software factory</p>
          <CommandMenu issues={issues} />
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
