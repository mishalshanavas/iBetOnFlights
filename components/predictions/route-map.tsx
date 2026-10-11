"use client";
import { useEffect, useRef, useState } from "react";
import type { Map, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import { useDashboard } from "@/stores/dashboard";
export function PredictionRouteMap({ routes, selected }: { routes: FeatureCollection<LineString>; selected: string | null }) {
  const container = useRef<HTMLDivElement>(null), map = useRef<Map | null>(null), [ready, setReady] = useState(false), [error, setError] = useState("");
  const theme = useDashboard(s => s.theme), latest = useRef(routes); latest.current = routes;
  useEffect(() => {
    let disposed = false;
    void import("maplibre-gl").then(gl => {
      if (disposed || !container.current) return;
      gl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs"); gl.setWorkerCount(Math.min(2, navigator.hardwareConcurrency || 2));
      const instance = new gl.Map({ container: container.current, style: theme === "light" ? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" : process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", center: [6, 55], zoom: 3.5, attributionControl: { compact: true }, pixelRatio: Math.min(devicePixelRatio, 2), maxTileCacheSize: 64, renderWorldCopies: false });
      map.current = instance;
      instance.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
      instance.on("load", () => {
        if (disposed) return;
        instance.addSource("outlook-routes", { type: "geojson", data: latest.current });
        instance.addLayer({ id: "outlook-routes", type: "line", source: "outlook-routes", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.7 } });
        setError(""); setReady(true);
      });
      instance.on("error", () => { if (!instance.isStyleLoaded()) setError("Route map could not load. The flight list is still available."); });
    }).catch(() => setError("Route map could not start."));
    return () => { disposed = true; map.current?.remove(); map.current = null; setReady(false); };
  }, [theme]);
  useEffect(() => {
    const instance = map.current; if (!ready || !instance) return;
    (instance.getSource("outlook-routes") as GeoJSONSource).setData(routes);
    instance.setPaintProperty("outlook-routes", "line-width", selected ? ["case", ["==", ["get", "id"], selected], 4, 1.5] : 2);
    instance.setPaintProperty("outlook-routes", "line-opacity", selected ? ["case", ["==", ["get", "id"], selected], 1, 0.25] : 0.7);
    const features = selected ? routes.features.filter(feature => feature.properties?.id === selected) : routes.features;
    const points = features.flatMap(feature => feature.geometry.coordinates);
    if (points.length) instance.fitBounds([[Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))], [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]], { padding: 50, maxZoom: 7, duration: 0 });
  }, [routes, selected, ready]);
  return <div className="prediction-route-map" data-testid="prediction-route-map" data-map-ready={ready} ref={container}>{error && <div className="prediction-map-message" role="status">{error}</div>}</div>;
}
