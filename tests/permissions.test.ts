import { describe, expect, it } from "vitest";
import { evaluatePermission, highestLevel, levelAtLeast } from "@/lib/permissions/engine";

describe("Permission Engine", () => {
  it("auto-approves reads when the workspace allows it", () => {
    const decision = evaluatePermission("READ", { autoApproveRead: true });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });

  it("requires approval for writes", () => {
    const decision = evaluatePermission("WRITE", { autoApproveRead: true });
    expect(decision.requiresApproval).toBe(true);
  });

  it("refuses external actions when the integration is not connected", () => {
    const decision = evaluatePermission("EXTERNAL_ACTION", { autoApproveRead: true, integrationStatus: "NOT_CONFIGURED" });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.reason).toMatch(/not configured/i);
  });

  it("always requires approval for high-impact actions", () => {
    const decision = evaluatePermission("HIGH_IMPACT", { autoApproveRead: true, integrationStatus: "CONNECTED" });
    expect(decision.requiresApproval).toBe(true);
  });

  it("ranks permission levels", () => {
    expect(highestLevel(["READ", "HIGH_IMPACT", "WRITE"])).toBe("HIGH_IMPACT");
    expect(levelAtLeast("WRITE", "READ")).toBe(true);
    expect(levelAtLeast("READ", "WRITE")).toBe(false);
  });
});
