'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  GitBranch,
  Link2,
  Play,
  Plus,
  Repeat,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Wrench,
  Workflow as WorkflowIcon,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Callout, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { cn, relativeTime } from '@/lib/utils';

type NodeType = 'TRIGGER' | 'AGENT' | 'TOOL' | 'CONDITION' | 'APPROVAL' | 'DELAY' | 'BRANCH' | 'LOOP' | 'OUTPUT';

interface WFNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  data: Record<string, unknown>;
}

interface WFEdge {
  id: string;
  from: string;
  to: string;
  fromHandle: string;
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  trigger: string;
  graph: string;
  updatedAt: string;
  runs: { id: string; status: string; createdAt: string; durationMs: number | null; error: string | null; output: string }[];
}

const NODE_TYPES: { type: NodeType; label: string; icon: React.ComponentType<{ className?: string }>; tint: string }[] = [
  { type: 'TRIGGER', label: 'Trigger', icon: Target, tint: 'text-good border-good/35 bg-good/10' },
  { type: 'AGENT', label: 'Agent', icon: Sparkles, tint: 'text-accent-soft border-accent/35 bg-accent/10' },
  { type: 'TOOL', label: 'Tool', icon: Wrench, tint: 'text-ink border-line-strong bg-surface-3' },
  { type: 'CONDITION', label: 'Condition', icon: GitBranch, tint: 'text-warn border-warn/35 bg-warn/10' },
  { type: 'APPROVAL', label: 'Approval', icon: ShieldCheck, tint: 'text-warn border-warn/35 bg-warn/10' },
  { type: 'DELAY', label: 'Delay', icon: Clock, tint: 'text-ink border-line-strong bg-surface-3' },
  { type: 'BRANCH', label: 'Branch', icon: GitBranch, tint: 'text-violet-soft border-violet/35 bg-violet/10' },
  { type: 'LOOP', label: 'Loop', icon: Repeat, tint: 'text-violet-soft border-violet/35 bg-violet/10' },
  { type: 'OUTPUT', label: 'Output', icon: CircleDot, tint: 'text-good border-good/35 bg-good/10' },
];

const AGENT_KEYS = ['planning', 'research', 'knowledge', 'execution', 'review', 'creative', 'analyst'];
const TOOL_KEYS = [
  'tasks.create', 'tasks.list', 'projects.update', 'documents.search', 'knowledge.retrieve',
  'web.search', 'email.draft', 'calendar.create', 'artifact.generate', 'data.task_metrics',
];

function nodeMeta(type: NodeType) {
  return NODE_TYPES.find((n) => n.type === type) ?? NODE_TYPES[1]!;
}

export function WorkflowBuilder() {
  const qc = useQueryClient();
  const { push } = useToast();
  const canvasRef = React.useRef<HTMLDivElement>(null);

  const [workflowId, setWorkflowId] = React.useState<string | null>(null);
  const [name, setName] = React.useState('Launch readiness check');
  const [nodes, setNodes] = React.useState<WFNode[]>([]);
  const [edges, setEdges] = React.useState<WFEdge[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [connectFrom, setConnectFrom] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState<{ id: string; dx: number; dy: number } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [validation, setValidation] = React.useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [lastRun, setLastRun] = React.useState<{ status: string; log: { label: string; status: string; detail?: string }[] } | null>(null);

  const { data } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => fetchJson<{ items: WorkflowRow[] }>('/api/workflows'),
  });

  function load(wf: WorkflowRow) {
    setWorkflowId(wf.id);
    setName(wf.name);
    try {
      const graph = JSON.parse(wf.graph) as { nodes: (WFNode & { data: Record<string, unknown> })[]; edges: WFEdge[] };
      setNodes(graph.nodes ?? []);
      setEdges(graph.edges ?? []);
    } catch {
      setNodes([]);
      setEdges([]);
    }
    setSelected(null);
    setValidation(null);
    setLastRun(null);
  }

  function newWorkflow() {
    setWorkflowId(null);
    setName('New workflow');
    setNodes([
      { id: 't1', type: 'TRIGGER', label: 'Manual trigger', x: 60, y: 40, data: {} },
      { id: 'a1', type: 'AGENT', label: 'Planning Agent', x: 60, y: 150, data: { agentKey: 'planning', instruction: 'Plan the launch' } },
      { id: 'o1', type: 'OUTPUT', label: 'Capture result', x: 60, y: 260, data: {} },
    ]);
    setEdges([
      { id: 'e1', from: 't1', to: 'a1', fromHandle: 'out' },
      { id: 'e2', from: 'a1', to: 'o1', fromHandle: 'out' },
    ]);
    setSelected('a1');
    setValidation(null);
    setLastRun(null);
  }

  function addNode(type: NodeType) {
    const id = `n${Date.now().toString(36)}`;
    setNodes((prev) => [
      ...prev,
      {
        id,
        type,
        label: newNodeLabel(type),
        x: 60 + (prev.length % 4) * 190,
        y: 40 + Math.floor(prev.length / 4) * 110,
        data: defaultData(type),
      },
    ]);
    setSelected(id);
  }

  function defaultData(type: NodeType): Record<string, unknown> {
    switch (type) {
      case 'AGENT':
        return { agentKey: 'planning', instruction: 'Analyse the current project state' };
      case 'TOOL':
        return { toolKey: 'tasks.create', args: { title: 'Follow up item', priority: 'MEDIUM' } };
      case 'CONDITION':
      case 'BRANCH':
        return { expression: 'true' };
      case 'APPROVAL':
        return { title: 'Approve this step', description: 'Workflow approval gate', permission: 'WRITE' };
      case 'DELAY':
        return { ms: 1000 };
      case 'LOOP':
        return { source: 'items', maxIterations: 3 };
      default:
        return {};
    }
  }

  function newNodeLabel(type: NodeType): string {
    return `${type.charAt(0)}${type.slice(1).toLowerCase()} node`;
  }

  function updateNode(id: string, patch: Partial<WFNode>) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  function updateNodeData(id: string, key: string, value: unknown) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, [key]: value } } : n)));
  }

  function removeNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (selected === id) setSelected(null);
  }

  function connect(to: string) {
    if (!connectFrom || connectFrom === to) {
      setConnectFrom(null);
      return;
    }
    setEdges((prev) => [
      ...prev.filter((e) => !(e.from === connectFrom && e.to === to)),
      { id: `e${Date.now().toString(36)}`, from: connectFrom, to, fromHandle: 'out' },
    ]);
    setConnectFrom(null);
  }

  // ── Drag ──────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - dragging.dx;
      const y = e.clientY - rect.top - dragging.dy;
      setNodes((prev) =>
        prev.map((n) => (n.id === dragging.id ? { ...n, x: Math.max(8, Math.min(rect.width - 190, x)), y: Math.max(8, y) } : n)),
      );
    }
    function onUp() {
      setDragging(null);
    }
    if (dragging) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  async function save() {
    setSaving(true);
    try {
      const graph = { nodes, edges };
      const payload = { name, graph, trigger: 'MANUAL' };
      const result = workflowId
        ? await fetchJson<{ workflow: WorkflowRow; validation: typeof validation }>(`/api/workflows/${workflowId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await fetchJson<{ workflow: WorkflowRow; validation: typeof validation }>('/api/workflows', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      setWorkflowId(result.workflow.id);
      setValidation(result.validation ?? null);
      push({
        title: result.validation && !result.validation.valid ? 'Saved as draft' : 'Workflow saved',
        description: result.validation && !result.validation.valid ? result.validation.errors.join('; ') : `${name} · v${result.workflow.version}`,
        tone: result.validation && !result.validation.valid ? 'error' : 'success',
      });
      await qc.invalidateQueries({ queryKey: ['workflows'] });
    } catch (error) {
      push({ title: 'Could not save workflow', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    if (!workflowId) {
      push({ title: 'Save the workflow first', description: 'Execution requires a persisted, validated graph.', tone: 'error' });
      return;
    }
    setRunning(true);
    setLastRun(null);
    try {
      const result = await fetchJson<{ runId: string; status: string; state?: { log: { label: string; status: string; detail?: string }[] } }>(
        `/api/workflows/${workflowId}/run`,
        { method: 'POST', body: JSON.stringify({ input: {} }) },
      );
      setLastRun({ status: result.status, log: result.state?.log ?? [] });
      push({
        title: result.status === 'WAITING_APPROVAL' ? 'Waiting for approval' : 'Workflow finished',
        description: `Status: ${result.status}`,
        tone: result.status === 'FAILED' ? 'error' : 'success',
      });
      await qc.invalidateQueries({ queryKey: ['workflows'] });
    } catch (error) {
      push({ title: 'Workflow failed', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setRunning(false);
    }
  }

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Workflows</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">Executable automation</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Graphs are saved, versioned, validated and executable. Conditions, approvals, delays, branches and loops are
            interpreted by the workflow engine — every step is recorded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={newWorkflow}>
            <Plus className="h-4 w-4" /> New
          </Button>
          <Button variant="secondary" loading={saving} onClick={save}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button variant="primary" loading={running} onClick={run}>
            <Play className="h-4 w-4" /> Run
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        {/* ── Palette + list ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px]">Node palette</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
              {NODE_TYPES.map((entry) => (
                <button
                  key={entry.type}
                  onClick={() => addNode(entry.type)}
                  className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/50 px-2.5 py-2 text-left text-[12.5px] text-ink-muted transition-colors hover:border-line-strong hover:bg-surface-3/60 hover:text-ink"
                >
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-md border', entry.tint)}>
                    <entry.icon className="h-3 w-3" />
                  </span>
                  {entry.label}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px]">Saved workflows</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {(data?.items ?? []).map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => load(wf)}
                  className={cn(
                    'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                    workflowId === wf.id ? 'border-accent/40 bg-accent/10' : 'border-line bg-surface-2/40 hover:bg-surface-3/50',
                  )}
                >
                  <span className="block truncate text-[12.5px] text-ink">{wf.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-ink-faint">
                    <Badge variant={wf.status === 'ACTIVE' ? 'good' : 'default'}>{wf.status}</Badge> v{wf.version} ·{' '}
                    {relativeTime(wf.updatedAt)}
                  </span>
                </button>
              ))}
              {!data?.items.length ? <p className="px-1 py-2 text-2xs text-ink-faint">No saved workflows yet.</p> : null}
            </CardContent>
          </Card>
        </div>

        {/* ── Canvas ─────────────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 max-w-xs text-[13px]" aria-label="Workflow name" />
            <div className="flex items-center gap-2">
              {connectFrom ? (
                <Badge variant="accent">Click a target node</Badge>
              ) : (
                <span className="text-2xs text-ink-faint">Drag nodes · select then Link to connect</span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div
              ref={canvasRef}
              className="relative h-[560px] overflow-auto rounded-xl border border-line bg-surface-2/30 bg-grid-faint [background-size:24px_24px]"
            >
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                {edges.map((edge) => {
                  const a = nodes.find((n) => n.id === edge.from);
                  const b = nodes.find((n) => n.id === edge.to);
                  if (!a || !b) return null;
                  const x1 = a.x + 88;
                  const y1 = a.y + 34;
                  const x2 = b.x + 88;
                  const y2 = b.y;
                  const mid = (y1 + y2) / 2;
                  return (
                    <path
                      key={edge.id}
                      d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                      fill="none"
                      stroke="rgba(139,108,255,0.55)"
                      strokeWidth={1.6}
                      markerEnd="url(#arrow)"
                    />
                  );
                })}
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(139,108,255,0.8)" />
                  </marker>
                </defs>
              </svg>

              {nodes.map((node) => {
                const meta = nodeMeta(node.type);
                const isSelected = selected === node.id;
                return (
                  <div
                    key={node.id}
                    style={{ left: node.x, top: node.y, width: 176 }}
                    onMouseDown={(e) => {
                      const rect = canvasRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setDragging({ id: node.id, dx: e.clientX - rect.left - node.x, dy: e.clientY - rect.top - node.y });
                    }}
                    onClick={() => {
                      if (connectFrom) connect(node.id);
                      else setSelected(node.id);
                    }}
                    className={cn(
                      'absolute cursor-grab select-none rounded-lg border bg-surface-1/95 p-2.5 shadow-lift backdrop-blur transition-shadow active:cursor-grabbing',
                      isSelected ? 'border-accent/60 shadow-glow' : 'border-line hover:border-line-strong',
                      connectFrom && 'ring-1 ring-violet/60',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border', meta.tint)}>
                        <meta.icon className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{node.label}</span>
                    </div>
                    <p className="mt-1.5 truncate text-[10px] text-ink-faint">
                      {node.type === 'AGENT'
                        ? `agent: ${String(node.data.agentKey ?? '—')}`
                        : node.type === 'TOOL'
                          ? `tool: ${String(node.data.toolKey ?? '—')}`
                          : node.type === 'CONDITION' || node.type === 'BRANCH'
                            ? String(node.data.expression ?? '')
                            : node.type === 'DELAY'
                              ? `${String(node.data.ms ?? 0)}ms`
                              : node.type.toLowerCase()}
                    </p>
                  </div>
                );
              })}

              {!nodes.length ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    icon={WorkflowIcon}
                    title="Empty canvas"
                    description="Add nodes from the palette, connect them, then save and run."
                    action={
                      <Button variant="primary" size="sm" onClick={newWorkflow}>
                        Start from template
                      </Button>
                    }
                  />
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* ── Inspector ──────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px]">Inspector</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedNode ? (
                <div className="space-y-3">
                  <div>
                    <p className="label mb-1.5">Type</p>
                    <Badge variant="outline">{selectedNode.type}</Badge>
                  </div>
                  <div>
                    <p className="label mb-1.5">Label</p>
                    <Input value={selectedNode.label} onChange={(e) => updateNode(selectedNode.id, { label: e.target.value })} className="h-8 text-[13px]" />
                  </div>

                  {selectedNode.type === 'AGENT' ? (
                    <>
                      <div>
                        <p className="label mb-1.5">Agent</p>
                        <Select
                          value={String(selectedNode.data.agentKey ?? 'planning')}
                          onChange={(e) => updateNodeData(selectedNode.id, 'agentKey', e.target.value)}
                          className="h-8 text-[13px]"
                        >
                          {AGENT_KEYS.map((key) => (
                            <option key={key} value={key}>
                              {key}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <p className="label mb-1.5">Instruction</p>
                        <Textarea
                          value={String(selectedNode.data.instruction ?? '')}
                          onChange={(e) => updateNodeData(selectedNode.id, 'instruction', e.target.value)}
                          rows={3}
                          className="text-[13px]"
                        />
                      </div>
                    </>
                  ) : null}

                  {selectedNode.type === 'TOOL' ? (
                    <>
                      <div>
                        <p className="label mb-1.5">Tool</p>
                        <Select
                          value={String(selectedNode.data.toolKey ?? 'tasks.create')}
                          onChange={(e) => updateNodeData(selectedNode.id, 'toolKey', e.target.value)}
                          className="h-8 text-[13px]"
                        >
                          {TOOL_KEYS.map((key) => (
                            <option key={key} value={key}>
                              {key}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <p className="label mb-1.5">Arguments (JSON)</p>
                        <Textarea
                          value={JSON.stringify(selectedNode.data.args ?? {}, null, 2)}
                          onChange={(e) => {
                            try {
                              updateNodeData(selectedNode.id, 'args', JSON.parse(e.target.value));
                            } catch {
                              /* keep editing */
                            }
                          }}
                          rows={5}
                          className="font-mono text-[11px]"
                        />
                      </div>
                    </>
                  ) : null}

                  {(selectedNode.type === 'CONDITION' || selectedNode.type === 'BRANCH') ? (
                    <div>
                      <p className="label mb-1.5">Expression</p>
                      <Input
                        value={String(selectedNode.data.expression ?? 'true')}
                        onChange={(e) => updateNodeData(selectedNode.id, 'expression', e.target.value)}
                        className="h-8 font-mono text-[12px]"
                        placeholder="a1.result.blocked > 0"
                      />
                      <p className="mt-1 text-2xs text-ink-faint">Supports &gt;, &lt;, &gt;=, &lt;=, ==, != and truthiness.</p>
                    </div>
                  ) : null}

                  {selectedNode.type === 'DELAY' ? (
                    <div>
                      <p className="label mb-1.5">Milliseconds</p>
                      <Input
                        type="number"
                        value={Number(selectedNode.data.ms ?? 1000)}
                        onChange={(e) => updateNodeData(selectedNode.id, 'ms', Number(e.target.value))}
                        className="h-8 text-[13px]"
                      />
                    </div>
                  ) : null}

                  {selectedNode.type === 'APPROVAL' ? (
                    <div className="space-y-2">
                      <div>
                        <p className="label mb-1.5">Title</p>
                        <Input
                          value={String(selectedNode.data.title ?? '')}
                          onChange={(e) => updateNodeData(selectedNode.id, 'title', e.target.value)}
                          className="h-8 text-[13px]"
                        />
                      </div>
                      <div>
                        <p className="label mb-1.5">Permission level</p>
                        <Select
                          value={String(selectedNode.data.permission ?? 'WRITE')}
                          onChange={(e) => updateNodeData(selectedNode.id, 'permission', e.target.value)}
                          className="h-8 text-[13px]"
                        >
                          <option value="WRITE">WRITE</option>
                          <option value="EXTERNAL_ACTION">EXTERNAL_ACTION</option>
                          <option value="HIGH_IMPACT">HIGH_IMPACT</option>
                        </Select>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex gap-2 border-t border-line-faint pt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => setConnectFrom(selectedNode.id)}
                    >
                      <Link2 className="h-3.5 w-3.5" /> Link
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => removeNode(selectedNode.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-ink-faint">
                  Select a node to edit its configuration. Drag nodes to rearrange the graph.
                </p>
              )}
            </CardContent>
          </Card>

          {validation ? (
            <Callout tone={validation.valid ? 'success' : 'error'} title={validation.valid ? 'Graph valid' : 'Validation errors'}>
              {validation.valid
                ? validation.warnings.length
                  ? validation.warnings.join(' · ')
                  : 'No issues found.'
                : validation.errors.join(' · ')}
            </Callout>
          ) : null}

          {lastRun ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px]">Last run · {lastRun.status}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {lastRun.log.map((entry, index) => (
                  <div key={index} className="flex items-start gap-2 text-[12px]">
                    {entry.status === 'COMPLETED' ? (
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-good" />
                    ) : entry.status === 'FAILED' ? (
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-bad" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-ink">{entry.label}</span>
                      {entry.detail ? <span className="block text-2xs text-ink-faint">{entry.detail}</span> : null}
                    </span>
                  </div>
                ))}
                {!lastRun.log.length ? <p className="text-[12px] text-ink-faint">No steps recorded.</p> : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
