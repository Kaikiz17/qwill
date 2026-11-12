import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ClaimKeyFile, SealedPacket, StoredWill } from "./protocol";

export type Drill = {
  will: StoredWill;
  virtualNow: number;
};

export type LockedWill = { id: string; vault: string; packet?: SealedPacket; letter?: string };

type State = {
  wills: StoredWill[];
  locked: LockedWill[];
  drills: Record<string, Drill>;
  upsertWill: (will: StoredWill) => void;
  rememberLocked: (items: LockedWill[]) => void;
  dropLocked: (id: string) => void;
  removeWill: (id: string) => void;
  saveDrill: (id: string, drill: Drill) => void;
  clearDrill: (id: string) => void;
};

const memoryStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useWills = create<State>()(
  persist(
    (set) => ({
      wills: [],
      locked: [],
      drills: {},
      upsertWill: (will) =>
        set((state) => {
          const exists = state.wills.some((item) => item.packet.id === will.packet.id);
          return {
            wills: exists
              ? state.wills.map((item) => (item.packet.id === will.packet.id ? will : item))
              : [will, ...state.wills],
            locked: (state.locked ?? []).filter((item) => (item.id || item.packet?.id) !== will.packet.id),
          };
        }),
      rememberLocked: (items) =>
        set((state) => {
          const locked = state.locked ?? [];
          const known = new Set([
            ...state.wills.map((item) => item.packet.id),
            ...locked.map((item) => item.id || item.packet?.id),
          ]);
          const fresh = items.filter((item) => !known.has(item.id || item.packet?.id || ""));
          return fresh.length === 0 ? state : { locked: [...fresh, ...locked] };
        }),
      dropLocked: (id) => set((state) => ({ locked: (state.locked ?? []).filter((item) => (item.id || item.packet?.id) !== id) })),
      removeWill: (id) =>
        set((state) => {
          const drills = { ...state.drills };
          delete drills[id];
          return { wills: state.wills.filter((item) => item.packet.id !== id), drills };
        }),
      saveDrill: (id, drill) => set((state) => ({ drills: { ...state.drills, [id]: drill } })),
      clearDrill: (id) =>
        set((state) => {
          const drills = { ...state.drills };
          delete drills[id];
          return { drills };
        }),
    }),
    {
      name: "qwill-desk",
      skipHydration: true,
      storage: createJSONStorage(() => (typeof window === "undefined" ? memoryStorage : localStorage)),
      partialize: (state) => ({ wills: state.wills, locked: state.locked, drills: state.drills }),
    },
  ),
);

const heldKeys = new Map<string, ClaimKeyFile[]>();

export function holdClaimKeys(willId: string, keys: ClaimKeyFile[]) {
  heldKeys.set(willId, keys);
}

export function peekClaimKeys(willId: string): ClaimKeyFile[] | null {
  return heldKeys.get(willId) ?? null;
}
