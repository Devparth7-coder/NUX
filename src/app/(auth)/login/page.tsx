import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/guard";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const ctx = await getAuthContext();
  if (ctx) redirect("/");

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-bg px-6">
      <div className="pointer-events-none absolute inset-0 grid-backdrop opacity-[0.55]" />
      <div className="pointer-events-none absolute left-1/2 top-[-18%] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(59,130,246,0.20),transparent)] blur-2xl" />
      <div className="relative w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[14px] bg-[linear-gradient(140deg,#1d4ed8_0%,#3b82f6_45%,#8b5cf6_100%)] shadow-[0_18px_50px_-18px_rgba(59,130,246,0.9)]">
            <span className="text-[18px] font-bold text-white">N</span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-gradient">NEXUS</h1>
          <p className="mt-2 text-[12.5px] tracking-[0.14em] text-mute uppercase">Think. Connect. Act.</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-[11.5px] leading-relaxed text-mute">
          Your digital world. One intelligent system.
        </p>
      </div>
    </div>
  );
}
