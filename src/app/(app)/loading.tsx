export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-10 md:px-8">
      <div className="space-y-4">
        <div className="h-7 w-56 rounded-lg bg-white/[0.05] animate-pulse-soft" />
        <div className="h-4 w-96 max-w-full rounded-lg bg-white/[0.04] animate-pulse-soft" />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-[12px] border border-line bg-surface-1 animate-pulse-soft" />
          ))}
        </div>
      </div>
    </div>
  );
}
