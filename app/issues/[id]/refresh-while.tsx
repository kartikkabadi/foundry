"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RefreshWhile({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      router.refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
