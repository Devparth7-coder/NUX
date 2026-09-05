import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/guard";
import { isDemoMode } from "@/lib/env";
import { AppShell } from "@/components/shell/app-shell";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  return (
    <AppShell
      user={{ name: ctx.user.name, email: ctx.user.email }}
      demoMode={isDemoMode}
    >
      {children}
    </AppShell>
  );
}
