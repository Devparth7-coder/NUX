import { route, ok } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";

export const POST = route({ auth: false }, async () => {
  await destroySession();
  return ok({ ok: true });
});
