"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Command, FolderKanban, CheckSquare, Activity, ShieldCheck, Search, Menu, Bell } from "lucide-react";
import { cn, titleCase } from "@/lib/utils";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { useUIStore } from "@/stores/ui";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";

const MOBILE_NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/command", label: "Command", icon: Command },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/activity", label: "Activity", icon: Activity },
];

export function AppShell({
  children,
  user,
  demoMode,
}: {
  children: React.ReactNode;
  user: { name: string; email: string } | null;
  demoMode: boolean;
}) {
  const pathname = usePathname();
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);

  const { data: counts } = useQuery({
    queryKey: ["nav-counts"],
    queryFn: () => api.get<{ pendingApprovals: number; unread: number; activeRuns: number }>("/api/nav/counts"),
    refetchInterval: 20_000,
  });

  const segment = pathname.split("/").filter(Boolean)[0] ?? "home";
  const title = segment === "runs" ? "Run inspection" : titleCase(segment.replace(/-/g, " "));

  return (
    <div className="flex min-h-[100dvh] bg-bg">
      <Sidebar user={user} />
      <CommandPalette />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl md:px-6">
          <span className="md:hidden text-[13.5px] font-semibold tracking-[0.14em] text-ink">NEXUS</span>
          <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-2 text-[12.5px] text-mute">
            <Link href="/" className="hover:text-dim">
              Workspace
            </Link>
            <span className="text-mute/60">/</span>
            <span className="text-dim">{title}</span>
          </nav>

          <div className="flex-1" />

          {demoMode ? (
            <Badge tone="violet" className="hidden sm:inline-flex" title="No external model provider configured — deterministic local inference is active">
              DEMO MODE
            </Badge>
          ) : null}

          <button
            onClick={() => setCommandOpen(true)}
            className="flex items-center gap-2 rounded-[10px] border border-line bg-surface-1 px-3 py-1.5 text-[12px] text-mute hover:text-dim hover:border-line-strong transition-colors"
            aria-label="Search"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline rounded border border-line bg-surface-3 px-1.5 py-0.5 text-[10px] font-mono">⌘K</kbd>
          </button>

          <Link
            href="/approvals"
            className="relative flex h-8 w-8 items-center justify-center rounded-[10px] border border-line bg-surface-1 text-mute hover:text-ink transition-colors"
            aria-label={`Approvals${counts?.pendingApprovals ? ` (${counts.pendingApprovals} pending)` : ""}`}
          >
            <ShieldCheck className="h-4 w-4" />
            {counts?.pendingApprovals ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[9.5px] font-bold text-white">
                {counts.pendingApprovals}
              </span>
            ) : null}
          </Link>

          <Link
            href="/notifications"
            className="relative flex h-8 w-8 items-center justify-center rounded-[10px] border border-line bg-surface-1 text-mute hover:text-ink transition-colors"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {counts?.unread ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold text-white">
                {counts.unread}
              </span>
            ) : null}
          </Link>
        </header>

        <main className="flex-1 min-w-0 pb-24 md:pb-10">{children}</main>

        {/* Mobile navigation */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-30 flex items-stretch justify-around border-t border-line bg-[rgba(8,9,13,0.94)] backdrop-blur-xl md:hidden"
          aria-label="Mobile navigation"
        >
          {MOBILE_NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition-colors",
                  active ? "text-accent-bright" : "text-mute",
                )}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={() => setCommandOpen(true)}
            className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] text-mute"
            aria-label="Open command palette"
          >
            <Menu className="h-[18px] w-[18px]" />
            More
          </button>
        </nav>
      </div>
    </div>
  );
}
