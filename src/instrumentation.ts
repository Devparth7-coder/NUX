export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrapServer } = await import("./server/pipeline/recovery");
  await bootstrapServer();
}
