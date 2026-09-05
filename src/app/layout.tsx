import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'NEXUS — Your digital world. One intelligent system.',
  description:
    'NEXUS is an intelligent operating layer for your digital world: intent, context, reasoning, planning, agent orchestration, execution, validation, memory.',
  applicationName: 'NEXUS',
};

export const viewport: Viewport = {
  themeColor: '#04060B',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-void text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
