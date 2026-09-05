'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  mobileNavOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setCommandPalette: (v: boolean) => void;
  setMobileNav: (v: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      mobileNavOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setCommandPalette: (v) => set({ commandPaletteOpen: v }),
      setMobileNav: (v) => set({ mobileNavOpen: v }),
    }),
    { name: 'nexus-app-state', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }) },
  ),
);
