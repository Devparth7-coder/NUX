import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { route, fail } from "@/lib/api";

type Params = { id: string };

export const GET = route<undefined, undefined, Params>({ auth: true }, async (req, ctx) => {
  try {
    const { id } = await ctx.params;
    const artifact = await prisma.artifact.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
    if (!artifact) throw Errors.notFound("Artifact");
    const format = new URL(req.url).searchParams.get("format") ?? artifact.format;
    const safeName = artifact.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    if (format === "json") {
      return new Response(JSON.stringify({ id: artifact.id, title: artifact.title, type: artifact.type, structured: artifact.structured, content: artifact.content }, null, 2), {
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${safeName}.json"` },
      });
    }
    return new Response(artifact.content, {
      headers: {
        "content-type": format === "csv" ? "text/csv" : "text/markdown",
        "content-disposition": `attachment; filename="${safeName}.${format === "csv" ? "csv" : "md"}"`,
      },
    });
  } catch (err) {
    return fail(err);
  }
});
