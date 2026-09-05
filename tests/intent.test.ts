import { describe, expect, it } from "vitest";
import { deterministicGenerate } from "@/lib/ai/deterministic";

type ParsedIntent = {
  objective: string;
  deadlineText: string | null;
  deadline: string | null;
  requiredCapabilities: string[];
  riskLevel: string;
  permissionsRequired: string[];
  confidence: number;
  projectContext: { id: string; name: string } | null;
};

const parse = (input: string, meta: Record<string, unknown> = {}) =>
  deterministicGenerate("intent.parse", [{ role: "user", content: input }], { rawInput: input, ...meta }) as ParsedIntent;

describe("Intent Engine", () => {
  it("detects the launch objective and resolves 'this week' to a real date", () => {
    const intent = parse("I want to launch NEXUS this week", {
      projectCandidates: [{ id: "proj_1", name: "NEXUS Launch" }],
    });
    expect(intent.objective).toBe("launch");
    expect(intent.deadlineText).toBe("this week");
    expect(new Date(intent.deadline!).getTime()).toBeGreaterThan(Date.now());
    expect(intent.projectContext?.id).toBe("proj_1");
    expect(intent.requiredCapabilities).toContain("planning");
    expect(intent.riskLevel).toBe("MEDIUM");
    expect(intent.confidence).toBeGreaterThan(0.6);
  });

  it("escalates risk and permissions for externally visible actions", () => {
    const intent = parse("Send the launch announcement to the waitlist today");
    expect(intent.requiredCapabilities).toContain("content");
    expect(intent.permissionsRequired).toContain("EXTERNAL_ACTION");
    expect(["HIGH", "CRITICAL"]).toContain(intent.riskLevel);
    expect(intent.deadlineText).toBe("today");
  });

  it("flags destructive requests as critical", () => {
    const intent = parse("Delete the production database");
    expect(intent.riskLevel).toBe("CRITICAL");
    expect(intent.permissionsRequired).toContain("HIGH_IMPACT");
  });

  it("resolves explicit and weekday deadlines", () => {
    expect(parse("Ship it by 2026-12-24").deadlineText).toBe("2026-12-24");
    expect(parse("Review the deck on friday").deadlineText).toBe("friday");
    expect(parse("Plan the roadmap").deadlineText).toBeNull();
  });
});
