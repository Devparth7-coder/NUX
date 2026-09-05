import { requirePageUser } from '@/server/auth/guard';
import { SettingsView } from '@/features/settings/settings-view';

export const metadata = { title: 'Settings — NEXUS' };

export default async function SettingsPage() {
  const user = await requirePageUser();
  return <SettingsView userName={user.name ?? 'Operator'} userEmail={user.email} />;
}
