'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: 'info' | 'success' | 'error';
}

interface ToastContextValue {
  push: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const push = React.useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-20 right-4 z-[120] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 md:bottom-6">
        <AnimatePresence>
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'pointer-events-auto flex gap-3 rounded-xl border bg-surface-2/95 p-3.5 shadow-panel backdrop-blur-xl',
                item.tone === 'success' && 'border-good/25',
                item.tone === 'error' && 'border-bad/25',
                (!item.tone || item.tone === 'info') && 'border-line-strong',
              )}
            >
              {item.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : null}
              {item.tone === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : null}
              {(!item.tone || item.tone === 'info') ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" /> : null}
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">{item.title}</p>
                {item.description ? <p className="mt-0.5 text-2xs leading-relaxed text-ink-muted">{item.description}</p> : null}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
