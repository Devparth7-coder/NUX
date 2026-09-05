import { isDemo } from '@/lib/ai';

export function getMode(): 'REAL' | 'DEMO' {
  return isDemo() ? 'DEMO' : 'REAL';
}
