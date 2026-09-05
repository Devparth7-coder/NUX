'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Bell,
  Blocks,
  Brain,
  Check,
  ChevronsLeft,
  Command as CommandIcon,
  FileText,
  FolderKanban,
  Home,
  LayoutGrid,
  Menu,
  Network,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/use-app-store';
import { Avatar } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { CommandPalette } from './command-palette';
import { fetchJson } from '@/hooks/use-session';

export interface ShellUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
}

const PRIMARY_NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/command', label: 'Command', icon: CommandIcon },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/knowledge', label: 'Knowledge', icon: Network },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/tasks', label: 'Tasks', icon: LayoutGrid },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/agents', label: 'Agents', icon: Blocks },
  { href: '/activity', label: 'Activity', icon: Activity },
];

const SECONDARY_NAV = [
  { href: '/search', label: 'Search', icon: Search },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/integrations', label: 'Integrations', icon: Sparkles },
  { href: '/memory', label: 'Memory', icon: Brain },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const MOBILE_NAV = [
  { href: '/command', label: 'Command', icon: CommandIcon },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/tasks', label: 'Tasks', icon: LayoutGrid },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/activity', label: 'Activity', icon: Activity },
];

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setCommandPalette = useAppStore((s) => s.setCommandPalette);
  const paletteOpen = useAppStore((s) => s.commandPaletteOpen);

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const [pendingApprovals, setPendingApprovals] = React.useState(0);
  const [mode, setMode] = React.useState<'REAL' | 'DEMO'>('REAL');

  const loadMeta = React.useCallback(async () => {
    try {
      const [notifications, approvals, session] = await Promise.all([
        fetchJson<{ unread: number }>('/api/notifications'),
        fetchJson<{ pending: number }>('/api/approvals?status=PENDING'),
        fetchJson<{ mode: 'REAL' | 'DEMO' }>('/api/auth/session'),
      ]);
      setUnread(notifications.unread);
      setPendingApprovals(approvals.pending);
      setMode(session.mode);
    } catch {
      /* keep last known values */
    }
  }, []);

  React.useEffect(() => {
    void loadMeta();
    const id = setInterval(loadMeta, 15_000);
    return () => clearInterval(id);
  }, [loadMeta, pathname]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCommandPalette]);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="relative flex min-h-screen">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-grid-faint [background-size:44px_44px] opacity-[0.55]" />

      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <motion.aside
        animate={{ width: collapsed ? 76 : 248 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-surface-0/80 backdrop-blur-2xl md:flex"
      >
        <div className="flex h-16 items-center gap-2.5 px-4">
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <Logo />
            {!collapsed ? (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[15px] font-semibold tracking-[0.18em]">
                NEXUS
              </motion.span>
            ) : null}
          </Link>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
          <div className="space-y-0.5">
            {!collapsed ? <p className="label px-2 pb-1.5">Workspace</p> : null}
            {PRIMARY_NAV.map((item) => (
              <NavItem key={item.href} {...item} active={isActive(item.href)} collapsed={collapsed} badge={item.href === '/approvals' ? pendingApprovals : undefined} />
            ))}
          </div>
          <div className="space-y-0.5">
            {!collapsed ? <p className="label px-2 pb-1.5">System</p> : null}
            {SECONDARY_NAV.map((item) => (
              <NavItem
                key={item.href}
                {...item}
                active={isActive(item.href)}
                collapsed={collapsed}
                badge={item.href === '/notifications' ? unread : undefined}
              />
            ))}
          </div>
        </nav>

        <div className="border-t border-line p-3">
          {!collapsed ? (
            <div className="mb-3 rounded-lg border border-line bg-surface-2/60 p-3">
              <div className="flex items-center justify-between">
                <span className="label">Mode</span>
                <Badge variant={mode === 'DEMO' ? 'warn' : 'good'}>{mode === 'DEMO' ? 'DEMO' : 'LIVE'}</Badge>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                {mode === 'DEMO'
                  ? 'Deterministic local model. Retrieval, tools, approvals and state are real.'
                  : 'Live model provider connected.'}
              </p>
            </div>
          ) : null}
          <button
            onClick={toggleSidebar}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-ink-faint transition-colors hover:bg-white/[0.05] hover:text-ink"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronsLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
            {!collapsed ? <span className="text-xs">Collapse</span> : null}
          </button>
        </div>
      </motion.aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <motion.div
        animate={{ marginLeft: collapsed ? 76 : 248 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="flex min-w-0 flex-1 flex-col md:ml-0"
      >
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-void/70 px-4 backdrop-blur-2xl md:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-white/[0.05] md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>

          <button
            onClick={() => setCommandPalette(true)}
            className="group flex h-9 flex-1 items-center gap-2.5 rounded-lg border border-line bg-surface-2/50 px-3 text-left text-sm text-ink-faint transition-colors hover:border-line-strong hover:bg-surface-2 md:max-w-md"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 truncate">Search or run a command…</span>
            <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-2xs text-ink-faint sm:inline">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <Badge variant={mode === 'DEMO' ? 'warn' : 'good'} className="hidden sm:inline-flex">
              {mode === 'DEMO' ? 'DEMO MODE' : 'LIVE'}
            </Badge>

            <Link
              href="/approvals"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
              aria-label="Approvals"
            >
              <ShieldCheck className="h-4.5 w-4.5" />
              {pendingApprovals > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warn shadow-[0_0_8px_rgba(245,181,68,0.9)]" />
              ) : null}
            </Link>

            <Link
              href="/notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
              aria-label="Notifications"
            >
              <Bell className="h-4.5 w-4.5" />
              {unread > 0 ? (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              ) : null}
            </Link>

            <button
              onClick={() => router.push('/settings')}
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-white/[0.05]"
              aria-label="Profile"
            >
              <Avatar name={user.name} className="h-7 w-7" />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-12">{children}</main>
      </motion.div>

      {/* ── Mobile bottom navigation ────────────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-surface-0/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl md:hidden">
        {MOBILE_NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-2xs transition-colors',
                active ? 'text-accent-soft' : 'text-ink-faint',
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
              {item.href === '/approvals' && pendingApprovals > 0 ? (
                <span className="absolute mt-0.5 h-1.5 w-1.5 rounded-full bg-warn" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* ── Mobile drawer ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[78%] max-w-xs flex-col border-r border-line bg-surface-0 md:hidden"
            >
              <div className="flex h-16 items-center justify-between px-4">
                <div className="flex items-center gap-2.5">
                  <Logo />
                  <span className="text-[15px] font-semibold tracking-[0.18em]">NEXUS</span>
                </div>
                <button onClick={() => setMobileOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-white/[0.05]">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
                <div className="space-y-0.5">
                  <p className="label px-2 pb-1.5">Workspace</p>
                  {PRIMARY_NAV.map((item) => (
                    <NavItem key={item.href} {...item} active={isActive(item.href)} onNavigate={() => setMobileOpen(false)} />
                  ))}
                </div>
                <div className="space-y-0.5">
                  <p className="label px-2 pb-1.5">System</p>
                  {SECONDARY_NAV.map((item) => (
                    <NavItem key={item.href} {...item} active={isActive(item.href)} onNavigate={() => setMobileOpen(false)} />
                  ))}
                </div>
              </nav>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <CommandPalette open={paletteOpen} onClose={() => setCommandPalette(false)} mode={mode} />
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
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed?: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={cn(
        'group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] transition-all duration-150',
        active ? 'bg-white/[0.07] text-ink' : 'text-ink-muted hover:bg-white/[0.04] hover:text-ink',
        collapsed && 'justify-center px-0',
      )}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_10px_rgba(61,126,255,0.9)]" />
      ) : null}
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-accent-soft')} />
      {!collapsed ? <span className="flex-1 truncate">{label}</span> : null}
      {!collapsed && badge ? (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 text-[10px] font-medium text-accent-soft">
          {badge}
        </span>
      ) : null}
      {collapsed && badge ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" /> : null}
    </Link>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('relative flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-2', className)}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
        <path d="M4 20V4l16 16V4" className="text-accent" />
      </svg>
      <span className="absolute inset-0 rounded-lg bg-accent-sheen opacity-70" />
    </span>
  );
}

export { Check };
