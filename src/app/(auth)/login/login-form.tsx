"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

export function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = React.useState("demo@nexus.ai");
  const [password, setPassword] = React.useState("nexus-demo-2026");
  const [busy, setBusy] = React.useState<null | "login" | "demo">(null);
  const [error, setError] = React.useState<string | null>(null);

  const finish = React.useCallback(() => {
    router.push("/");
    router.refresh();
  }, [router]);

  async function submit(event: React.FormEvent, mode: "login" | "demo") {
    event.preventDefault();
    setBusy(mode);
    setError(null);
    try {
      if (mode === "demo") {
        await api.post("/api/auth/demo");
      } else {
        await api.post("/api/auth/login", { email, password });
      }
      toast({ tone: "success", title: "Signed in", body: "NEXUS is ready." });
      finish();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed";
      setError(message);
      toast({ tone: "error", title: "Sign-in failed", body: message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel-raised p-6">
      <form onSubmit={(e) => submit(e, "login")} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error ? (
          <p className="rounded-lg border border-red/25 bg-red/[0.08] px-3 py-2 text-[12px] text-red" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === "login"}>
          Sign in <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-mute">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={(e) => submit(e as unknown as React.FormEvent, "demo")}
        loading={busy === "demo"}
      >
        <Sparkles className="h-4 w-4 text-violet" />
        Enter the NEXUS demo workspace
      </Button>
      <p className="mt-3 text-center text-[11px] leading-relaxed text-mute">
        The demo signs you into a seeded workspace with indexed documents, tasks, knowledge and memory.
      </p>
    </div>
  );
}
