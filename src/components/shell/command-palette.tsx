'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  Blocks,
  CornerDownLeft,
  FileText,
  FolderKanban,
  LayoutGrid,
  Network,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Workflow,
  Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchJson } from '@/hooks/use-session';
import type { SearchResult } from '@/lib/retrieval/global';
import { Spinner } from '@/components/ui/spinner';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  run: (ctx: { router: ReturnType<typeof useRouter>; close: () => void; query: string }) => void | Promise<void>;
}

export function CommandPalette({
  open,
  onClose,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  mode: 'REAL' | 'DEMO';
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  // Debounced semantic + keyword search across the workspace.
  React.useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const data = await fetchJson<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`);
        setResults(data.results.slice(0, 8));
        setActive(0);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(id);
  }, [query, open]);

  const commands = React.useMemo<Command[]>(
    () => [
      { id: 'cmd-command', label: 'Open Command Center', hint: 'Run an intent', group: 'Navigate', icon: Sparkles, run: ({ router, close }) => { router.push('/command'); close(); } },
      { id: 'cmd-projects', label: 'Open Projects', group: 'Navigate', icon: FolderKanban, run: ({ router, close }) => { router.push('/projects'); close(); } },
      { id: 'cmd-knowledge', label: 'Open Knowledge', group: 'Navigate', icon: Network, run: ({ router, close }) => { router.push('/knowledge'); close(); } },
      { id: 'cmd-documents', label: 'Open Documents', group: 'Navigate', icon: FileText, run: ({ router, close }) => { router.push('/documents'); close(); } },
      { id: 'cmd-tasks', label: 'Open Tasks', group: 'Navigate', icon: LayoutGrid, run: ({ router, close }) => { router.push('/tasks'); close(); } },
      { id: 'cmd-workflows', label: 'Open Workflows', group: 'Navigate', icon: Workflow, run: ({ router, close }) => { router.push('/workflows'); close(); } },
      { id: 'cmd-agents', label: 'Open Agents', group: 'Navigate', icon: Blocks, run: ({ router, close }) => { router.push('/agents'); close(); } },
      { id: 'cmd-approvals', label: 'View approvals', group: 'Navigate', icon: ShieldCheck, run: ({ router, close }) => { router.push('/approvals'); close(); } },
      { id: 'cmd-activity', label: 'Open Activity', group: 'Navigate', icon: Activity, run: ({ router, close }) => { router.push('/activity'); close(); } },
      { id: 'cmd-memory', label: 'Open Memory', group: 'Navigate', icon: Brain, run: ({ router, close }) => { router.push('/memory'); close(); } },
      { id: 'cmd-settings', label: 'Open Settings', group: 'Navigate', icon: Settings, run: ({ router, close }) => { router.push('/settings'); close(); } },
      {
        id: 'act-new-project',
        label: 'Create project',
        hint: 'Opens Projects with the composer focused',
        group: 'Create',
        icon: FolderKanban,
        run: ({ router, close }) => { router.push('/projects?new=1'); close(); },
      },
      {
        id: 'act-new-task',
        label: 'Create task',
        hint: 'Opens Tasks with the composer open',
        group: 'Create',
        icon: LayoutGrid,
        run: ({ router, close }) => { router.push('/tasks?new=1'); close(); },
      },
      {
        id: 'act-upload',
        label: 'Upload document',
        hint: 'Ingest a PDF, DOCX, TXT, CSV or MD',
        group: 'Create',
        icon: FileText,
        run: ({ router, close }) => { router.push('/documents?upload=1'); close(); },
      },
      {
        id: 'act-run',
        label: 'Run a command',
        hint: 'Starts the agent pipeline with your text',
        group: 'Run',
        icon: Sparkles,
        run: ({ router, close, query }) => {
          router.push(`/command?q=${encodeURIComponent(query)}`);
          close();
        },
      },
    ],
    [],
  );

  const filteredCommands = React.useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }, [commands, query]);

  const rows = React.useMemo(() => {
    const commandRows = filteredCommands.map((c) => ({ kind: 'command' as const, item: c }));
    const resultRows = results.map((r) => ({ kind: 'result' as const, item: r }));
    return [...commandRows, ...resultRows];
  }, [filteredCommands, results]);

  const runRow = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.kind === 'command') {
      void row.item.run({ router, close: onClose, query });
    } else {
      if (row.item.href) router.push(row.item.href);
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runRow(active);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line-strong bg-surface-1/95 shadow-panel backdrop-blur-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4 w-4 shrink-0 text-ink-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search knowledge, documents, tasks… or type a command"
                className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
                aria-label="Search or command"
              />
              {searching ? <Spinner className="h-4 w-4 text-ink-faint" /> : null}
              <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-2xs text-ink-faint">ESC</kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {rows.length === 0 ? (
                <p className="px-3 py-8 text-center text-[13px] text-ink-faint">
                  {query.trim().length < 2 ? 'Start typing to search the workspace.' : 'No matches in this workspace.'}
                </p>
              ) : (
                rows.map((row, index) => {
                  const isActive = index === active;
                  if (row.kind === 'command') {
                    const Icon = row.item.icon;
                    return (
                      <button
                        key={row.item.id}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => runRow(index)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                          isActive ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
                        )}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-accent-soft' : 'text-ink-faint')} />
                        <span className="flex-1 truncate text-[13px] text-ink">{row.item.label}</span>
                        {row.item.hint ? <span className="hidden text-2xs text-ink-faint sm:inline">{row.item.hint}</span> : null}
                        <span className="label">{row.item.group}</span>
                        {isActive ? <CornerDownLeft className="h-3.5 w-3.5 text-ink-faint" /> : null}
                      </button>
                    );
                  }
                  const result = row.item;
                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => runRow(index)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                        isActive ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
                      )}
                    >
                      <span className="mt-0.5 flex h-5 items-center rounded border border-line bg-surface-2 px-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                        {result.type}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{result.title}</span>
                        <span className="block truncate text-2xs text-ink-faint">{result.snippet}</span>
                      </span>
                      <span className="shrink-0 font-mono text-2xs text-ink-faint">{result.relevance.toFixed(2)}</span>
                      <ArrowRight className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-accent-soft' : 'text-transparent')} />
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-2xs text-ink-faint">
              <span>
                {mode === 'DEMO' ? 'Demo mode · deterministic local model' : 'Live provider connected'}
              </span>
              <span className="flex items-center gap-3">
                <span>↑↓ navigate</span>
                <span>↵ select</span>
              </span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
