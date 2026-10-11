import { create } from "zustand";
export const motionSpeeds = [.25, .5, 1, 2, 4, 8] as const;
export const useMapMotion = create<{ speed: number; playing: boolean; setSpeed: (speed: number) => void; toggle: () => void }>(set => ({
  speed: 1, playing: true,
  setSpeed: speed => { if (motionSpeeds.some(value => value === speed)) set({ speed }); },
  toggle: () => set(state => ({ playing: !state.playing })),
}));
