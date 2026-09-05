'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Lock, Mail, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/misc';
import { Logo } from '@/components/shell/app-shell';
import { setStoredToken, storedToken } from '@/hooks/use-session';
import { Spinner } from '@/components/ui/spinner';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('demo@nexus.ai');
  const [password, setPassword] = React.useState('nexus-demo-2026');
  const [mode, setMode] = React.useState<'signin' | 'signup'>('signin');
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // A stored token means we already authenticated once in this browser but the
  // server did not see a session — i.e. this preview's cookie was dropped.
  const [cookieBlocked, setCookieBlocked] = React.useState(false);

  React.useEffect(() => {
    setCookieBlocked(Boolean(storedToken()));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const endpoint = mode === 'signin' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'signin' ? { email, password } : { email, password, name: name || email.split('@')[0] };
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? 'Authentication failed');
      // Keep a copy of the token: if the browser refuses the cookie in this
      // embedded context, API calls still authenticate with the bearer header.
      setStoredToken((data?.data?.token as string | undefined) ?? (data?.token as string | undefined) ?? null);
      setCookieBlocked(false);
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid-faint [background-size:48px_48px] opacity-40" />
      <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-accent/12 blur-[130px]" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[400px]"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-11 w-11" />
          <h1 className="mt-5 text-[26px] font-semibold tracking-[0.2em]">NEXUS</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            Your digital world. One intelligent system.
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface-1/70 p-6 shadow-panel backdrop-blur-2xl">
          <div className="mb-5 flex rounded-lg border border-line bg-surface-2/60 p-1">
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md py-1.5 text-[13px] font-medium transition-colors ${
                  mode === m ? 'bg-surface-4 text-ink' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {m === 'signin' ? 'Sign in' : 'Create workspace'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' ? (
              <label className="block">
                <span className="label mb-1.5 block">Name</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Avery Chen" autoComplete="name" />
              </label>
            ) : null}

            <label className="block">
              <span className="label mb-1.5 block">Email</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <Input value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" autoComplete="email" required />
              </div>
            </label>

            <label className="block">
              <span className="label mb-1.5 block">Password</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                />
              </div>
            </label>

            {error ? <Callout tone="error">{error}</Callout> : null}

            {cookieBlocked ? (
              <Callout tone="warning">
                This browser is blocking cookies for the embedded preview, so the server cannot see your session after
                sign-in. Open NEXUS in a new tab to continue.
                <a
                  href={typeof window === 'undefined' ? '/' : `${window.location.origin}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 block text-accent-soft hover:underline"
                >
                  Open NEXUS in a new tab →
                </a>
              </Callout>
            ) : null}

            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {busy ? 'Authenticating' : mode === 'signin' ? 'Enter NEXUS' : 'Create workspace'}
              {!busy ? <ArrowRight className="h-4 w-4" /> : null}
            </Button>
          </form>

          <div className="mt-5 rounded-lg border border-line bg-surface-2/50 p-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-accent-soft" />
              <p className="text-2xs font-medium uppercase tracking-[0.12em] text-ink-muted">Demo workspace</p>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
              Sign in with the seeded account to explore a real NEXUS workspace: 5 indexed documents, an active launch
              project, 7 agents and 25 tools.
            </p>
            <p className="mt-2 font-mono text-2xs text-ink-muted">demo@nexus.ai · nexus-demo-2026</p>
          </div>
        </div>

        <p className="mt-6 text-center text-2xs leading-relaxed text-ink-faint">
          Sessions are signed, httpOnly and verified server-side. Credentials never leave the server.
          <br />
          <Link href="/command" className="mt-1 inline-block text-accent-soft hover:underline">
            Continue to Command →
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
