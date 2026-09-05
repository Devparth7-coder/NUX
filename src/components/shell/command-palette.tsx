"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import {
  Home,
  Command as CommandIcon,
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
  Plus,
  Play,
  ArrowRight,
} from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { api } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";

type Action = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  run: (ctx: { router: ReturnType<typeof useRouter>; close: () => void }) => void | Promise<void>;
};

export function CommandPalette() {
  const open = useUIStore((s) => s.commandOpen);
  const setOpen = useUIStore((s) => s.setCommandOpen);
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(!useUIStore.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);

  const { data: search } = useQuery({
    queryKey: ["palette-search", query],
    queryFn: () => api.get<{ semantic: Array<{ id: string; title: string; kind: string; sourceRef: string }> }>(`/api/search?q=${encodeURIComponent(query)}&limit=6`),
    enabled: query.trim().length > 2,
    staleTime: 5_000,
  });

  const close = React.useCallback(() => setOpen(false), [setOpen]);

  const actions: Action[] = React.useMemo(
    () => [
      { id: "task", label: "Create task", group: "Create", icon: Plus, run: ({ router }) => router.push("/tasks?new=1") },
      { id: "project", label: "Create project", group: "Create", icon: FolderKanban, run: ({ router }) => router.push("/projects?new=1") },
      { id: "intent", label: "Run an intent…", hint: "Start the pipeline", group: "Create", icon: CommandIcon, run: ({ router }) => router.push("/command") },
      { id: "knowledge", label: "Search knowledge", group: "Search", icon: Brain, run: ({ router }) => router.push(`/knowledge?q=${encodeURIComponent(query)}`) },
      { id: "documents", label: "Search documents", group: "Search", icon: FileText, run: ({ router }) => router.push(`/documents?q=${encodeURIComponent(query)}`) },
      { id: "tasks", label: "Find tasks", group: "Search", icon: CheckSquare, run: ({ router }) => router.push(`/tasks?q=${encodeURIComponent(query)}`) },
      { id: "agents", label: "Run agent", group: "Run", icon: Bot, run: ({ router }) => router.push("/agents") },
      { id: "workflows", label: "Start workflow", group: "Run", icon: Workflow, run: ({ router }) => router.push("/workflows") },
      { id: "approvals", label: "View approvals", group: "Go to", icon: ShieldCheck, run: ({ router }) => router.push("/approvals") },
      { id: "home", label: "Go to Home", group: "Go to", icon: Home, run: ({ router }) => router.push("/") },
      { id: "command", label: "Go to Command", group: "Go to", icon: CommandIcon, run: ({ router }) => router.push("/command") },
      { id: "projects", label: "Open projects", group: "Go to", icon: FolderKanban, run: ({ router }) => router.push("/projects") },
      { id: "activity", label: "Open activity", group: "Go to", icon: Activity, run: ({ router }) => router.push("/activity") },
      { id: "notifications", label: "Open notifications", group: "Go to", icon: Bell, run: ({ router }) => router.push("/notifications") },
      { id: "integrations", label: "Open integrations", group: "Go to", icon: Puzzle, run: ({ router }) => router.push("/integrations") },
      { id: "settings", label: "Open settings", group: "Go to", icon: Settings, run: ({ router }) => router.push("/settings") },
    ],
    [query],
  );

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[18%] z-[61] w-[min(94vw,620px)] -translate-x-1/2 panel-raised overflow-hidden animate-fade-up"
          aria-label="Command palette"
        >
          <CommandPrimitive shouldFilter={false} loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4 w-4 text-mute" />
              <CommandPrimitive.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Type a command or search everything…"
                className="h-14 flex-1 bg-transparent text-[14px] text-ink placeholder:text-mute/70 outline-none"
              />
              <kbd className="rounded border border-line bg-surface-3 px-1.5 py-0.5 text-[10px] font-mono text-mute">ESC</kbd>
            </div>

            <CommandPrimitive.List className="max-h-[52vh] overflow-y-auto p-2">
              <CommandPrimitive.Empty className="px-4 py-8 text-center text-[12.5px] text-mute">
                No matching command.
              </CommandPrimitive.Empty>

              {filtered.length ? (
                <CommandPrimitive.Group
                  heading={<span className="px-2 text-[9.5px] uppercase tracking-[0.14em] text-mute/80">Actions</span>}
                  className="mb-1"
                >
                  {filtered.map((action) => (
                    <CommandPrimitive.Item
                      key={action.id}
                      value={action.id + action.label}
                      onSelect={() => action.run({ router, close })}
                      className="flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] text-dim data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-ink"
                    >
                      <action.icon className="h-4 w-4 text-mute" />
                      <span className="flex-1">{action.label}</span>
                      {action.hint ? <span className="text-[11px] text-mute">{action.hint}</span> : null}
                      <ArrowRight className="h-3.5 w-3.5 text-mute opacity-0 data-[selected=true]:opacity-100" />
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              ) : null}

              {search?.semantic?.length ? (
                <CommandPrimitive.Group
                  heading={<span className="px-2 text-[9.5px] uppercase tracking-[0.14em] text-mute/80">Workspace results</span>}
                >
                  {search.semantic.map((item) => (
                    <CommandPrimitive.Item
                      key={item.id}
                      value={item.id + item.title}
                      onSelect={() => {
                        close();
                        router.push(item.sourceRef);
                      }}
                      className="flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] text-dim data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-ink"
                    >
                      <Play className="h-3.5 w-3.5 text-mute" />
                      <span className="flex-1 truncate">{item.title}</span>
                      <span className="text-[10.5px] uppercase tracking-wide text-mute">{item.kind}</span>
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              ) : null}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
