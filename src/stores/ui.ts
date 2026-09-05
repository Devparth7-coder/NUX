"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type UIState = {
  sidebarCollapsed: boolean;
  commandOpen: boolean;
  reducedMotion: boolean;
  toggleSidebar: () => void;
  setSidebar: (collapsed: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  setReducedMotion: (value: boolean) => void;
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      commandOpen: false,
      reducedMotion: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebar: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
    }),
    { name: "nexus-ui" },
  ),
);
