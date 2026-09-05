"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  applyNodeChanges as applyRFNodeChanges,
  applyEdgeChanges as applyRFEdgeChanges,
  type Edge,
  type Node,
  type NodeProps,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Play, Save, Trash2, AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, relativeTime, titleCase } from "@/lib/utils";
import type { AgentSummary } from "@/types/api";

const NODE_TYPES = ["TRIGGER", "AGENT", "TOOL", "CONDITION", "APPROVAL", "DELAY", "BRANCH", "LOOP", "OUTPUT"] as const;
type NodeType = (typeof NODE_TYPES)[number];

const TYPE_COLOR: Record<NodeType, string> = {
  TRIGGER: "#34D399",
  AGENT: "#60A5FA",
  TOOL: "#F59E0B",
  CONDITION: "#8B5CF6",
  APPROVAL: "#F472B6",
  DELAY: "#94A3B8",
  BRANCH: "#22D3EE",
  LOOP: "#A3E635",
  OUTPUT: "#E2E8F0",
};

type WorkflowNodeData = {
  key: string;
  type: NodeType;
  label: string;
  config: Record<string, unknown>;
  onSelect: (id: string) => void;
  status?: string;
  [key: string]: unknown;
};

function WorkflowNodeView({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData;
  const color = TYPE_COLOR[nodeData.type];
  return (
    <div
      onClick={() => nodeData.onSelect(id)}
      className={cn(
        "w-[190px] cursor-pointer rounded-[12px] border bg-surface-2 px-3 py-2.5 transition-colors",
        selected ? "border-accent/60" : "border-line hover:border-line-strong",
      )}
      style={{ boxShadow: selected ? `0 0 0 1px ${color}55, 0 14px 36px -22px ${color}` : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-mute" />
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-medium tracking-[0.08em] text-mute">{nodeData.type}</span>
        {nodeData.status ? (
          <Badge tone={STATUS_TONE[nodeData.status] ?? "neutral"} className="ml-auto">
            {titleCase(nodeData.status)}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1.5 truncate text-[12.5px] text-ink">{nodeData.label}</p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-mute" />
    </div>
  );
}

const nodeTypes = { workflowNode: WorkflowNodeView };

export default function WorkflowBuilderPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["workflow", params.id],
    queryFn: () =>
      api.get<{
        workflow: {
          id: string;
          name: string;
          description: string | null;
          status: string;
          version: number;
          nodes: Array<{ id: string; key: string; type: NodeType; label: string; config: Record<string, unknown>; positionX: number; positionY: number }>;
          edges: Array<{ id: string; sourceId: string; targetId: string; label: string | null; condition: string | null }>;
          runs: Array<{ id: string; status: string; output: unknown; error: string | null; createdAt: string }>;
        };
        validation: { ok: boolean; errors: string[]; warnings: string[] };
      }>(`/api/workflows/${params.id}`),
    refetchInterval: (query) => {
      const runs = (query.state.data as { workflow: { runs: Array<{ status: string }> } } | undefined)?.workflow?.runs;
      return runs?.some((r) => ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(r.status)) ? 3000 : false;
    },
  });

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<{ agents: AgentSummary[] }>("/api/agents"),
  });
  const { data: tools } = useQuery({
    queryKey: ["tools"],
    queryFn: () => api.get<{ tools: Array<{ key: string; name: string; category: string; permissionLevel: string }> }>("/api/tools"),
  });

  const [nodes, setNodes] = React.useState<Node[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);

  React.useEffect(() => {
    if (!data) return;
    setNodes(
      data.workflow.nodes.map((node) => ({
        id: node.id,
        type: "workflowNode",
        position: { x: node.positionX, y: node.positionY },
        data: {
          key: node.key,
          type: node.type,
          label: node.label,
          config: node.config ?? {},
          onSelect: (id: string) => setSelected(id),
        } as unknown as WorkflowNodeData,
      })),
    );
    setEdges(
      data.workflow.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        label: edge.label ?? undefined,
        animated: true,
        style: { stroke: "rgba(255,255,255,0.22)" },
      })),
    );
  }, [data]);

  const onNodesChange = React.useCallback((changes: NodeChange<Node>[]) => {
    setNodes((prev) => applyRFNodeChanges(changes, prev));
  }, []);

  const selectedNode = data?.workflow.nodes.find((n) => n.id === selected) ?? null;

  function addNode(type: NodeType) {
    const key = `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`;
    const id = `tmp-${key}`;
    setNodes((prev) => [
      ...prev,
      {
        id,
        type: "workflowNode",
        position: { x: 120 + prev.length * 40, y: 200 + (prev.length % 3) * 90 },
        data: {
          key,
          type,
          label: titleCase(type),
          config: type === "AGENT" ? { agentKey: "planning" } : type === "TOOL" ? { toolKey: "tasks.list", toolInput: {} } : type === "CONDITION" ? { expression: "output.ready == true" } : {},
          onSelect: (nodeId: string) => setSelected(nodeId),
        } as unknown as WorkflowNodeData,
      },
    ]);
    setSelected(id);
  }

  function updateNode(id: string, patch: Partial<{ label: string; type: NodeType; config: Record<string, unknown> }>) {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== id) return node;
        const data = node.data as unknown as WorkflowNodeData;
        return { ...node, data: { ...data, ...patch } as unknown as WorkflowNodeData };
      }),
    );
  }

  function removeNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
    setSelected(null);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        nodes: nodes.map((node) => {
          const data = node.data as unknown as WorkflowNodeData;
          return {
            key: data.key,
            type: data.type,
            label: data.label,
            config: data.config ?? {},
            positionX: Math.round(node.position.x),
            positionY: Math.round(node.position.y),
          };
        }),
        edges: edges.map((edge) => ({
          sourceKey: (nodes.find((n) => n.id === edge.source)?.data as unknown as WorkflowNodeData)?.key ?? "",
          targetKey: (nodes.find((n) => n.id === edge.target)?.data as unknown as WorkflowNodeData)?.key ?? "",
          label: typeof edge.label === "string" ? edge.label : null,
        })),
      };
      await api.patch(`/api/workflows/${params.id}`, payload);
      toast({ tone: "success", title: "Workflow saved", body: "Version incremented." });
      void queryClient.invalidateQueries({ queryKey: ["workflow", params.id] });
    } catch (err) {
      toast({ tone: "error", title: "Save failed", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    try {
      const result = await api.post<{ runId: string }>(`/api/workflows/${params.id}/run`, { input: { query: "workflow execution" } });
      toast({ tone: "success", title: "Workflow queued" });
      void queryClient.invalidateQueries({ queryKey: ["workflow", params.id] });
      void result;
    } catch (err) {
      toast({ tone: "error", title: "Workflow rejected", body: err instanceof Error ? err.message : String(err) });
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8">
        <LoadingRows rows={5} />
      </div>
    );
  }
  if (!data) return null;

  const latestRun = data.workflow.runs[0];

  return (
    <div className="mx-auto w-full max-w-[1320px] px-5 py-6 md:px-8">
      <Link href="/workflows" className="inline-flex items-center gap-1.5 text-[11.5px] text-mute hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Workflows
      </Link>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{data.workflow.name}</h1>
          <p className="mt-1 text-[12.5px] text-mute">
            v{data.workflow.version} · {nodes.length} nodes · {edges.length} edges · {titleCase(data.workflow.status)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md" onClick={() => void run()}>
            <Play className="h-3.5 w-3.5" /> Run
          </Button>
          <Button variant="primary" size="md" onClick={save} loading={saving}>
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </div>

      {!data.validation.ok ? (
        <div className="mt-4 flex items-start gap-2 rounded-[12px] border border-red/25 bg-red/[0.06] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red" />
          <div>
            <p className="text-[12.5px] font-medium text-red">This workflow will not run</p>
            <ul className="mt-1 space-y-0.5 text-[11.5px] text-dim">
              {data.validation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : data.validation.warnings.length ? (
        <div className="mt-4 flex items-start gap-2 rounded-[12px] border border-amber/25 bg-amber/[0.05] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
          <ul className="space-y-0.5 text-[11.5px] text-dim">
            {data.validation.warnings.slice(0, 4).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <div className="h-[520px]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={(changes: EdgeChange<Edge>[]) => setEdges((prev) => applyRFEdgeChanges(changes, prev))}
              onConnect={(connection: Connection) =>
                setEdges((prev) => [
                  ...prev,
                  {
                    id: `e-${connection.source}-${connection.target}-${prev.length}`,
                    source: connection.source!,
                    target: connection.target!,
                    animated: true,
                    style: { stroke: "rgba(255,255,255,0.22)" },
                  },
                ])
              }
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
              className="bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.05),transparent_60%)]"
            >
              <Background color="rgba(255,255,255,0.05)" gap={22} size={1} />
              <Controls className="!border-line !bg-surface-2 [&>button]:!border-line [&>button]:!bg-surface-1 [&>button]:!text-dim" />
            </ReactFlow>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-3">
            <span className="text-[11px] uppercase tracking-[0.1em] text-mute">Add</span>
            {NODE_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => addNode(type)}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-1 px-2 py-1 text-[11px] text-mute transition-colors hover:border-line-strong hover:text-dim"
              >
                <Plus className="h-2.5 w-2.5" />
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: TYPE_COLOR[type] }} />
                {titleCase(type)}
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{selectedNode ? "Node" : "Inspector"}</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {selectedNode ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Label</Label>
                    <Input
                      value={(nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.label ?? ""}
                      onChange={(e) => updateNode(selected!, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select
                      value={(nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.type}
                      onChange={(e) => updateNode(selected!, { type: e.target.value as NodeType })}
                    >
                      {NODE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {titleCase(type)}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {(nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.type === "AGENT" ? (
                    <div className="space-y-1.5">
                      <Label>Agent</Label>
                      <Select
                        value={String(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config?.agentKey ?? "planning"))}
                        onChange={(e) =>
                          updateNode(selected!, {
                            config: { ...(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config ?? {})), agentKey: e.target.value },
                          })
                        }
                      >
                        {agents?.agents?.map((agent) => (
                          <option key={agent.id} value={agent.key}>
                            {agent.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : null}

                  {(nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.type === "TOOL" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label>Tool</Label>
                        <Select
                          value={String(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config?.toolKey ?? "tasks.list"))}
                          onChange={(e) =>
                            updateNode(selected!, {
                              config: { ...(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config ?? {})), toolKey: e.target.value },
                            })
                          }
                        >
                          {tools?.tools?.map((tool) => (
                            <option key={tool.key} value={tool.key}>
                              {tool.key}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Input (JSON)</Label>
                        <Textarea
                          rows={4}
                          className="font-mono text-[11.5px]"
                          defaultValue={JSON.stringify(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config?.toolInput ?? {}), null, 2)}
                          onBlur={(e) => {
                            try {
                              updateNode(selected!, {
                                config: { ...(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config ?? {})), toolInput: JSON.parse(e.target.value) },
                              });
                            } catch {
                              toast({ tone: "error", title: "Invalid JSON input" });
                            }
                          }}
                        />
                      </div>
                    </>
                  ) : null}

                  {["CONDITION", "BRANCH"].includes(String((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.type)) ? (
                    <div className="space-y-1.5">
                      <Label>Expression</Label>
                      <Input
                        defaultValue={String(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config?.expression ?? ""))}
                        placeholder="research.confidence > 0.6"
                        onBlur={(e) =>
                          updateNode(selected!, {
                            config: { ...(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config ?? {})), expression: e.target.value },
                          })
                        }
                      />
                      <p className="text-[10.5px] text-mute">
                        Supports &gt;, &lt;, &gt;=, &lt;=, ==, != and contains. Evaluated safely — never eval.
                      </p>
                    </div>
                  ) : null}

                  {(nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.type === "DELAY" ? (
                    <div className="space-y-1.5">
                      <Label>Delay (ms)</Label>
                      <Input
                        type="number"
                        defaultValue={Number(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config?.delayMs ?? 5000))}
                        onBlur={(e) =>
                          updateNode(selected!, {
                            config: { ...(((nodes.find((n) => n.id === selected)?.data as unknown as WorkflowNodeData)?.config ?? {})), delayMs: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                  ) : null}

                  <Button variant="ghost" size="sm" onClick={() => removeNode(selected!)} className="text-red hover:text-red">
                    <Trash2 className="h-3.5 w-3.5" /> Delete node
                  </Button>
                </div>
              ) : (
                <p className="py-8 text-center text-[12px] text-mute">Select a node to edit its configuration.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Runs</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {data.workflow.runs.length ? (
                <ul className="space-y-2">
                  {data.workflow.runs.slice(0, 6).map((run) => (
                    <li key={run.id} className="rounded-[10px] border border-line bg-surface-1 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {run.status === "COMPLETED" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber" />}
                        <code className="flex-1 truncate font-mono text-[11px] text-dim">{run.id}</code>
                        <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{titleCase(run.status)}</Badge>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-mute">
                        <span>{relativeTime(run.createdAt)}</span>
                        {run.error ? <span className="truncate text-red">{run.error}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-8 text-center text-[12px] text-mute">This workflow has not run yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {search.get("run") ? (
        <p className="mt-4 text-center text-[11.5px] text-mute">
          Run {search.get("run")} queued. Progress appears above.
        </p>
      ) : null}
      {latestRun ? (
        <p className="mt-2 text-center text-[11px] text-mute">
          Latest run {latestRun.id} · {titleCase(latestRun.status)}
        </p>
      ) : null}
    </div>
  );
}
