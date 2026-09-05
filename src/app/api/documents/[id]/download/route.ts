import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { storage } from "@/lib/storage";
import { route, fail } from "@/lib/api";

type Params = { id: string };

export const GET = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  try {
    const { id } = await ctx.params;
    const doc = await prisma.document.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
    if (!doc) throw Errors.notFound("Document");
    const buffer = await storage().get(doc.storageKey);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": doc.mimeType,
        "content-disposition": `attachment; filename="${encodeURIComponent(doc.filename)}"`,
        "content-length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    return fail(err);
  }
});
