import { z } from "zod";
import { prisma } from "@/lib/db";
import { registerTool } from "@/lib/tools/registry";
import { ExecutableError } from "@/lib/errors";
import type { IntegrationKind } from "@prisma/client";

/**
 * External tools are honest about their availability: if the integration is not
 * connected, the call fails with an actionable reason. Nothing is fabricated.
 */
async function requireIntegration(workspaceId: string, kind: IntegrationKind) {
  const integration = await prisma.integration.findUnique({ where: { workspaceId_kind: { workspaceId, kind } } });
  if (!integration || integration.status !== "CONNECTED") {
    throw new ExecutableError(
      `${kind.replace(/_/g, " ")} is ${(integration?.status ?? "NOT_CONFIGURED").replace(/_/g, " ").toLowerCase()}. Connect it in Settings → Integrations to enable this action.`,
      { retryable: false, detail: { integration: kind, status: integration?.status ?? "NOT_CONFIGURED" } },
    );
  }
  return integration;
}

registerTool({
  key: "web.search",
  name: "Search the web",
  description: "Live web search. Requires a search provider credential; unavailable in DEMO MODE.",
  category: "WEB",
  permissionLevel: "READ",
  inputSchema: z.object({ query: z.string().min(3), limit: z.number().int().min(1).max(10).default(5) }),
  summarize: (i) => `Search the web for “${i.query}”`,
  handler: async (input) => {
    throw new ExecutableError(
      `Web search is unavailable: no search provider credential is configured. NEXUS will not invent sources — retrieved workspace evidence is used instead.`,
      { retryable: false, detail: { query: input.query, reason: "NO_SEARCH_PROVIDER" } },
    );
  },
});

registerTool({
  key: "github.repository",
  name: "Read GitHub repository",
  description: "Read repository metadata and issues through the connected GitHub integration.",
  category: "GITHUB",
  permissionLevel: "READ",
  requiresIntegration: "GITHUB",
  inputSchema: z.object({ repo: z.string().min(3) }),
  summarize: (i) => `Read GitHub repository ${i.repo}`,
  handler: async (input, ctx) => {
    const integration = await requireIntegration(ctx.workspaceId, "GITHUB");
    const token = integration.credentials;
    const res = await fetch(`https://api.github.com/repos/${input.repo}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    }).catch((e) => {
      throw new ExecutableError(`GitHub request failed: ${String(e)}`, { retryable: true });
    });
    if (!res.ok) throw new ExecutableError(`GitHub responded ${res.status}`, { retryable: res.status >= 500 });
    return (await res.json()) as Record<string, unknown>;
  },
});

registerTool({
  key: "github.issue.create",
  name: "Create GitHub issue",
  description: "Create an issue in a connected GitHub repository. External action — always requires approval.",
  category: "GITHUB",
  permissionLevel: "EXTERNAL_ACTION",
  requiresIntegration: "GITHUB",
  inputSchema: z.object({ repo: z.string().min(3), title: z.string().min(3), body: z.string().default("") }),
  summarize: (i) => `Create GitHub issue “${i.title}” in ${i.repo}`,
  affectedData: (i) => ({ repo: i.repo, title: i.title, external: "github.com" }),
  handler: async (input, ctx) => {
    const integration = await requireIntegration(ctx.workspaceId, "GITHUB");
    const res = await fetch(`https://api.github.com/repos/${input.repo}/issues`, {
      method: "POST",
      headers: { authorization: `Bearer ${integration.credentials}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ title: input.title, body: input.body }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => {
      throw new ExecutableError(`GitHub request failed: ${String(e)}`, { retryable: true });
    });
    if (!res.ok) throw new ExecutableError(`GitHub responded ${res.status}: ${(await res.text()).slice(0, 200)}`, { retryable: res.status >= 500 });
    const json = (await res.json()) as { number: number; html_url: string; title: string };
    return { number: json.number, url: json.html_url, title: json.title };
  },
});

registerTool({
  key: "calendar.create",
  name: "Create calendar event",
  description: "Create an event on the connected Google Calendar. External action — always requires approval.",
  category: "CALENDAR",
  permissionLevel: "EXTERNAL_ACTION",
  requiresIntegration: "GOOGLE_CALENDAR",
  inputSchema: z.object({ title: z.string().min(3), startsAt: z.string().datetime(), durationMinutes: z.number().int().min(5).max(480).default(30) }),
  summarize: (i) => `Create calendar event “${i.title}” at ${i.startsAt}`,
  affectedData: (i) => ({ title: i.title, startsAt: i.startsAt, durationMinutes: i.durationMinutes, external: "Google Calendar" }),
  handler: async (input, ctx) => {
    const integration = await requireIntegration(ctx.workspaceId, "GOOGLE_CALENDAR");
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { authorization: `Bearer ${integration.credentials}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: input.title,
        start: { dateTime: input.startsAt },
        end: { dateTime: new Date(new Date(input.startsAt).getTime() + input.durationMinutes * 60_000).toISOString() },
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => {
      throw new ExecutableError(`Google Calendar request failed: ${String(e)}`, { retryable: true });
    });
    if (!res.ok) throw new ExecutableError(`Google Calendar responded ${res.status}`, { retryable: res.status >= 500 });
    return (await res.json()) as Record<string, unknown>;
  },
});

registerTool({
  key: "email.draft",
  name: "Draft email",
  description: "Create a Gmail draft through the connected account. External action — always requires approval.",
  category: "EMAIL",
  permissionLevel: "EXTERNAL_ACTION",
  requiresIntegration: "GMAIL",
  inputSchema: z.object({ to: z.string().email(), subject: z.string().min(3), body: z.string().min(1) }),
  summarize: (i) => `Draft email to ${i.to}: “${i.subject}”`,
  affectedData: (i) => ({ to: i.to, subject: i.subject, external: "Gmail" }),
  handler: async (input, ctx) => {
    const integration = await requireIntegration(ctx.workspaceId, "GMAIL");
    const raw = [`To: ${input.to}`, `Subject: ${input.subject}`, "", input.body].join("\n");
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: { authorization: `Bearer ${integration.credentials}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { raw: Buffer.from(raw).toString("base64url") } }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => {
      throw new ExecutableError(`Gmail request failed: ${String(e)}`, { retryable: true });
    });
    if (!res.ok) throw new ExecutableError(`Gmail responded ${res.status}`, { retryable: res.status >= 500 });
    return (await res.json()) as Record<string, unknown>;
  },
});

registerTool({
  key: "slack.message",
  name: "Send Slack message",
  description: "Post a message to a Slack channel. External action — always requires approval.",
  category: "EMAIL",
  permissionLevel: "EXTERNAL_ACTION",
  requiresIntegration: "SLACK",
  inputSchema: z.object({ channel: z.string().min(2), text: z.string().min(1) }),
  summarize: (i) => `Post Slack message to ${i.channel}`,
  affectedData: (i) => ({ channel: i.channel, external: "Slack" }),
  handler: async (input, ctx) => {
    const integration = await requireIntegration(ctx.workspaceId, "SLACK");
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${integration.credentials}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: input.channel, text: input.text }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => {
      throw new ExecutableError(`Slack request failed: ${String(e)}`, { retryable: true });
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!res.ok || !json.ok) throw new ExecutableError(`Slack error: ${json.error ?? res.status}`, { retryable: false });
    return json;
  },
});
