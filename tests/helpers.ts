import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export const WORKSPACE_ID = "ws_demo_nexus";
export const USER_ID = "usr_demo_nexus";

export async function waitFor<T>(
  predicate: () => Promise<T | null | undefined | false>,
  { timeout = 60_000, interval = 250, label = "condition" } = {},
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await predicate();
    if (result) return result as T;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${label} after ${timeout}ms`);
}
