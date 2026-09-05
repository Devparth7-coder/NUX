"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Command,
  FolderKanban,
  Brain,
  FileText,
  CheckSquare,
  Workflow,
  Bot,
  Activity,
  ShieldCheck,
  Search,
  Bell,
  Puzzle,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { api } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";

const PRIMARY_NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/command", label: "Command", icon: Command },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/knowledge", label: "Knowledge", icon: Brain },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/activity", label: "Activity", icon: Activity },
];

const SECONDARY_NAV = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/integrations", label: "Integrations", icon: Puzzle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ user }: { user: { name: string; email: string } | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);

  const { data: counts } = useQuery({
    queryKey: ["nav-counts"],
    queryFn: () => api.get<{ pendingApprovals: number; unread: number; activeRuns: number }>("/api/nav/counts"),
    refetchInterval: 20_000,
  });

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col shrink-0 h-[100dvh] sticky top-0 z-30",
        "border-r border-line bg-[linear-gradient(180deg,#0a0c12_0%,#08090d_60%)]",
        "transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        collapsed ? "w-[68px]" : "w-[246px]",
      )}
      aria-label="Primary navigation"
    >
      {/* Brand */}
      <div className={cn("flex items-center gap-3 px-4 h-[60px] border-b border-line", collapsed && "justify-center px-0")}>
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="NEXUS home">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-[9px] bg-[linear-gradient(140deg,#1d4ed8_0%,#3b82f6_45%,#8b5cf6_100%)] shadow-[0_8px_24px_-10px_rgba(59,130,246,0.9)]">
            <span className="text-[13px] font-bold tracking-tight text-white">N</span>
          </span>
          {!collapsed ? (
            <span className="flex flex-col leading-none">
              <span className="text-[13.5px] font-semibold tracking-[0.14em] text-ink">NEXUS</span>
              <span className="text-[9.5px] tracking-[0.16em] text-mute mt-0.5">OPERATING LAYER</span>
            </span>
          ) : null}
        </Link>
      </div>

      {/* Command launcher */}
      <div className={cn("px-3 pt-3", collapsed && "px-2")}>
        <button
          onClick={() => setCommandOpen(true)}
          className={cn(
            "w-full flex items-center gap-2 rounded-[10px] border border-line bg-surface-1 px-2.5 py-2 text-[12.5px] text-mute",
            "hover:text-dim hover:border-line-strong transition-colors",
            collapsed && "justify-center px-0",
          )}
          aria-label="Open command palette"
        >
          <Search className="h-3.5 w-3.5" />
          {!collapsed ? (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded border border-line bg-surface-3 px-1.5 py-0.5 text-[10px] font-mono text-mute">⌘K</kbd>
            </>
          ) : null}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <NavGroup collapsed={collapsed} label="Workspace">
          {PRIMARY_NAV.map((item) => (
            <NavItem key={item.href} {...item} active={isActive(item.href)} collapsed={collapsed} />
          ))}
        </NavGroup>

        <NavGroup collapsed={collapsed} label="System">
          {SECONDARY_NAV.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              active={isActive(item.href)}
              collapsed={collapsed}
              badge={
                item.href === "/approvals"
                  ? counts?.pendingApprovals
                  : item.href === "/notifications"
                    ? counts?.unread
                    : undefined
              }
            />
          ))}
        </NavGroup>
      </nav>

      {/* Footer */}
      <div className="border-t border-line p-3 space-y-2">
        {!collapsed && counts?.activeRuns ? (
          <Link
            href="/activity"
            className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/[0.07] px-2.5 py-2 text-[11.5px] text-[#9dc0ff] hover:bg-accent/[0.12] transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5 animate-pulse-soft" />
            {counts.activeRuns} run{counts.activeRuns === 1 ? "" : "s"} in progress
          </Link>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "w-full flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-left hover:bg-white/[0.05] transition-colors",
                collapsed && "justify-center px-0",
              )}
              aria-label="Account menu"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(140deg,#1e293b,#334155)] text-[11px] font-semibold text-ink">
                {user?.name?.slice(0, 1) ?? "N"}
              </span>
              {!collapsed ? (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{user?.name ?? "Operator"}</span>
                  <span className="block truncate text-[10.5px] text-mute">{user?.email ?? ""}</span>
                </span>
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuLabel>{user?.email ?? "Account"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/settings")}>
              <User className="h-3.5 w-3.5" /> Profile & settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                await api.post("/api/auth/logout");
                router.push("/login");
                router.refresh();
              }}
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={toggle}
          className={cn(
            "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] text-mute hover:text-dim hover:bg-white/[0.05] transition-colors",
            collapsed && "justify-center px-0",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
          {!collapsed ? <span>Collapse</span> : null}
        </button>
      </div>
    </aside>
  );
}

function NavGroup({
  label,
  children,
  collapsed,
}: {
  label: string;
  children: React.ReactNode;
  collapsed: boolean;
}) {
  return (
    <div className="space-y-0.5">
      {!collapsed ? (
        <p className="px-2.5 pb-1.5 text-[9.5px] font-medium uppercase tracking-[0.14em] text-mute/80">{label}</p>
      ) : (
        <div className="mx-auto mb-2 h-px w-6 bg-line" />
      )}
      {children}
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[12.5px] transition-all duration-150",
        collapsed && "justify-center px-0",
        active ? "bg-white/[0.07] text-ink" : "text-dim hover:bg-white/[0.04] hover:text-ink",
      )}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
    >
      {active ? <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r bg-accent" /> : null}
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-accent-bright" : "text-mute group-hover:text-dim")} />
      {!collapsed ? <span className="flex-1 truncate">{label}</span> : null}
      {!collapsed && badge ? (
        <span className="rounded-full bg-red/15 px-1.5 py-0.5 text-[10px] font-semibold text-red">{badge}</span>
      ) : null}
      {collapsed && badge ? (
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red" />
      ) : null}
    </Link>
  );
}
