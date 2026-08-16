"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type PaletteIssue = { id: string; idea: string };

export function CommandMenu({ issues }: { issues: PaletteIssue[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <>
      <button
        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        type="button"
      >
        Search ⌘K
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24">
          <div className="w-full max-w-lg rounded-md border border-border bg-background shadow-lg">
            <Command>
              <CommandInput placeholder="Go to an Issue, Gate, Project…" />
              <CommandList>
                <CommandEmpty>Nothing matches.</CommandEmpty>
                <CommandGroup heading="Factory">
                  <CommandItem onSelect={() => go("/")}>Issues</CommandItem>
                  <CommandItem onSelect={() => go("/gates")}>Gates</CommandItem>
                  <CommandItem onSelect={() => go("/projects")}>Projects</CommandItem>
                  <CommandItem onSelect={() => go("/cycles")}>Cycles</CommandItem>
                  <CommandItem onSelect={() => go("/modules")}>Modules</CommandItem>
                  <CommandItem onSelect={() => go("/workers")}>Workers</CommandItem>
                </CommandGroup>
                <CommandGroup heading="Issues">
                  {issues.slice(0, 20).map((issue) => (
                    <CommandItem key={issue.id} onSelect={() => go(`/issues/${issue.id}`)}>
                      {issue.idea}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
            <button
              className="w-full border-t border-border py-2 text-xs text-muted-foreground"
              onClick={() => setOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
