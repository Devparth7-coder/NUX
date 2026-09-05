import { route, ok } from "@/lib/api";
import { cancelRun } from "@/server/pipeline/run-service";

type Params = { id: string };

export const POST = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  await cancelRun(id, ctx.auth.userId);
  return ok({ cancelled: true });
});
