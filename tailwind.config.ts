import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        void: '#04060B',
        surface: {
          0: '#070A11',
          1: '#0B0F18',
          2: '#111622',
          3: '#171E2C',
          4: '#1E2635',
        },
        line: {
          DEFAULT: 'rgba(255,255,255,0.07)',
          strong: 'rgba(255,255,255,0.12)',
          faint: 'rgba(255,255,255,0.04)',
        },
        ink: {
          DEFAULT: '#E9EDF6',
          muted: '#98A3B8',
          faint: '#6A7488',
        },
        accent: {
          DEFAULT: '#3D7EFF',
          soft: '#6E9BFF',
          deep: '#1F4FD8',
        },
        violet: {
          DEFAULT: '#8B6CFF',
          soft: '#A995FF',
        },
        good: '#38D39F',
        warn: '#F5B544',
        bad: '#FF5C6C',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(61,126,255,0.30), 0 0 24px -4px rgba(61,126,255,0.35)',
        'glow-violet': '0 0 0 1px rgba(139,108,255,0.28), 0 0 22px -6px rgba(139,108,255,0.32)',
        lift: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 18px 40px -24px rgba(0,0,0,0.9)',
        panel: '0 24px 60px -30px rgba(0,0,0,0.95)',
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)',
        'accent-sheen': 'linear-gradient(135deg, rgba(61,126,255,0.16), rgba(139,108,255,0.10) 45%, transparent 70%)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.7' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        'flow-dash': { to: { strokeDashoffset: '-24' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        breathe: { '0%,100%': { opacity: '0.45' }, '50%': { opacity: '1' } },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'flow-dash': 'flow-dash 1s linear infinite',
        shimmer: 'shimmer 2s infinite',
        'fade-up': 'fade-up 0.35s cubic-bezier(0.16,1,0.3,1)',
        breathe: 'breathe 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
