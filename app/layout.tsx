import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/app/_components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ensureWatchdog } from "@/lib/foundry/watchdog";
import { listIssues, navCounts } from "@/lib/foundry/store";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Foundry",
  description: "Human-in-the-loop software factory",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  ensureWatchdog();
  const issues = listIssues();
  const counts = navCounts();
  return (
    <html className={cn("dark", sans.variable, mono.variable)} lang="en">
      <body className="bg-black text-neutral-100">
        <TooltipProvider>
          <AppShell
            counts={counts}
            issues={issues.map((issue) => ({ id: issue.id, idea: issue.idea }))}
          >
            {children}
          </AppShell>
        </TooltipProvider>
      </body>
    </html>
  );
}
