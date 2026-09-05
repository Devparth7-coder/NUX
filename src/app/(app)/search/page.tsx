"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty";
import { relativeTime, titleCase, truncate } from "@/lib/utils";

type SemanticResult = {
  id: string;
  kind: string;
  title: string;
  snippet: string;
  source: string;
  sourceRef: string;
  score: { semantic: number; keyword: number; project: number; recency: number; entity: number; total: number };
  why: string[];
};

export default function SearchPage() {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () =>
      api.get<{
        query: string;
        semantic: SemanticResult[];
        groups: {
          projects: Array<{ id: string; name: string; health: string; progress: number }>;
          tasks: Array<{ id: string; title: string; status: string; priority: string }>;
          conversations: Array<{ id: string; title: string }>;
          agents: Array<{ id: string; name: string; description: string }>;
          activity: Array<{ id: string; summary: string; kind: string; createdAt: string }>;
        };
        total: number;
      }>(`/api/search?q=${encodeURIComponent(debounced)}&limit=12`),
    enabled: debounced.trim().length > 2,
  });

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8 md:px-8">
      <PageHeader
        title="Search"
        description="Hybrid retrieval across projects, documents, tasks, knowledge, memory and conversations — semantic similarity plus keyword ranking, with the reason each result was selected."
      />

      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your entire workspace…"
          className="h-12 pl-11 text-[14px]"
          aria-label="Search workspace"
          autoFocus
        />
        {isFetching ? <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-mute" /> : null}
      </div>

      {debounced.trim().length <= 2 ? (
        <Card className="mt-6">
          <EmptyState icon={Search} title="Start typing" description="Semantic and keyword retrieval run together across every surface." />
        </Card>
      ) : data ? (
        <div className="mt-6 space-y-5">
          <p className="text-[11.5px] text-mute">{data.total} result(s) for “{data.query}”</p>

          <section>
            <h3 className="mb-2 text-[12px] font-medium uppercase tracking-[0.1em] text-mute">Semantic matches</h3>
            <div className="space-y-2">
              {data.semantic.map((result) => (
                <Link key={result.id} href={result.sourceRef}>
                  <Card className="transition-colors hover:border-line-strong">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <Badge tone="accent">{titleCase(result.kind)}</Badge>
                        <h4 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{result.title}</h4>
                        <span className="font-mono text-[11px] text-mute">{result.score.total.toFixed(3)}</span>
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-dim">{truncate(result.snippet, 220)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {result.why.map((reason) => (
                          <span key={reason} className="rounded-md border border-line bg-surface-1 px-1.5 py-0.5 text-[10px] text-mute">
                            {reason}
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {!data.semantic.length ? (
                <Card>
                  <EmptyState icon={Search} title="No semantic matches" description="Try different wording or a broader query." />
                </Card>
              ) : null}
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <Group title="Projects">
              {data.groups.projects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`} className="block rounded-[10px] border border-line bg-surface-1 px-3 py-2.5 hover:border-line-strong">
                  <span className="text-[12.5px] text-ink">{project.name}</span>
                  <span className="ml-2 text-[11px] text-mute">{titleCase(project.health)} · {project.progress}%</span>
                </Link>
              ))}
            </Group>

            <Group title="Tasks">
              {data.groups.tasks.map((task) => (
                <Link key={task.id} href={`/tasks`} className="block rounded-[10px] border border-line bg-surface-1 px-3 py-2.5 hover:border-line-strong">
                  <span className="text-[12.5px] text-ink">{task.title}</span>
                  <span className="ml-2 text-[11px] text-mute">
                    {titleCase(task.status)} · {titleCase(task.priority)}
                  </span>
                </Link>
              ))}
            </Group>

            <Group title="Agents">
              {data.groups.agents.map((agent) => (
                <Link key={agent.id} href={`/agents/${agent.id}`} className="block rounded-[10px] border border-line bg-surface-1 px-3 py-2.5 hover:border-line-strong">
                  <span className="text-[12.5px] text-ink">{agent.name}</span>
                  <p className="text-[11px] text-mute">{truncate(agent.description, 70)}</p>
                </Link>
              ))}
            </Group>

            <Group title="Activity">
              {data.groups.activity.map((item) => (
                <div key={item.id} className="block rounded-[10px] border border-line bg-surface-1 px-3 py-2.5">
                  <span className="text-[12.5px] text-ink">{truncate(item.summary, 70)}</span>
                  <p className="text-[11px] text-mute">
                    {titleCase(item.kind)} · {relativeTime(item.createdAt)}
                  </p>
                </div>
              ))}
            </Group>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-3">{children}</CardContent>
    </Card>
  );
}
