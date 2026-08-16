import type { NavCounts } from "@/lib/foundry/types";
import Link from "next/link";

const ITEMS = [
  { href: "/", label: "Issues", key: "issues" as const },
  { href: "/gates", label: "Gates", key: "gates" as const },
  { href: "/projects", label: "Projects", key: "projects" as const },
  { href: "/cycles", label: "Cycles", key: "cycles" as const },
  { href: "/modules", label: "Modules", key: "modules" as const },
  { href: "/workers", label: "Workers", key: "workers" as const },
];

export function Sidebar({ counts }: { counts: NavCounts }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex h-11 items-center px-4 text-sm text-muted-foreground">Foundry</div>
      <nav className="flex flex-col gap-1 px-2 py-2">
        {ITEMS.map((item) => (
          <Link
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent"
            href={item.href}
            key={item.href}
          >
            <span>{item.label}</span>
            <span className="font-mono text-xs text-muted-foreground">{counts[item.key]}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
