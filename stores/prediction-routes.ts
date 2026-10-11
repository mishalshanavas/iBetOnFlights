import { create } from "zustand";
import type { FeatureCollection, LineString } from "geojson";
export const usePredictionRoutes = create<{ date: string | null; routes: FeatureCollection<LineString>; set: (date: string, routes: FeatureCollection<LineString>) => void; clear: () => void }>(set => ({
  date: null, routes: { type: "FeatureCollection", features: [] }, set: (date, routes) => set({ date, routes }), clear: () => set({ date: null, routes: { type: "FeatureCollection", features: [] } }),
}));
