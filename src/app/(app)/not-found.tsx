import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[560px] px-5 py-20">
      <Card className="p-8 text-center">
        <p className="text-[11px] uppercase tracking-[0.18em] text-mute">404</p>
        <h1 className="mt-3 text-[20px] font-semibold text-ink">This surface does not exist</h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
          The route is not part of the NEXUS workspace. Nothing was executed.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/command">
            <Button variant="primary" size="md">
              Open command
            </Button>
          </Link>
          <Link href="/">
            <Button variant="secondary" size="md">
              Dashboard
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
