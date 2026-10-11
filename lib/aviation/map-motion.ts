import type { Map } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import type { Aircraft } from "@/lib/types";

/** Visual dead reckoning only. Reported positions and stored tracks remain untouched. */
export function motionPosition(aircraft: Aircraft, seconds: number): [number, number] {
  if (aircraft.onGround || aircraft.heading === null || aircraft.velocity === null || aircraft.velocity <= 0) return [aircraft.longitude, aircraft.latitude];
  const rad = Math.PI / 180, latitude = aircraft.latitude * rad, longitude = aircraft.longitude * rad;
  const angle = aircraft.velocity * Math.min(120, Math.max(0, seconds)) / 6371008.8, heading = aircraft.heading * rad;
  const nextLatitude = Math.asin(Math.sin(latitude) * Math.cos(angle) + Math.cos(latitude) * Math.sin(angle) * Math.cos(heading));
  const nextLongitude = longitude + Math.atan2(Math.sin(heading) * Math.sin(angle) * Math.cos(latitude), Math.cos(angle) - Math.sin(latitude) * Math.sin(nextLatitude));
  return [((nextLongitude / rad + 540) % 360) - 180, nextLatitude / rad];
}
type Hit = { id: string; coordinates: [number, number]; x: number; y: number };
/** A continuous illustrative circuit, measured in screen pixels so motion stays visible at regional zooms. */
export function visualFlightOffset(seconds: number, heading: number) {
  const phase = seconds * .1, angle = heading * Math.PI / 180;
  const forward = 140 * Math.sin(phase), sideways = 90 * (1 - Math.cos(phase));
  const dx = 14 * Math.cos(phase), dy = 9 * Math.sin(phase);
  return {
    x: forward * Math.sin(angle) + sideways * Math.cos(angle),
    y: -forward * Math.cos(angle) + sideways * Math.sin(angle),
    rotation: Math.atan2(dx * Math.sin(angle) + dy * Math.cos(angle), dx * Math.cos(angle) - dy * Math.sin(angle)),
  };
}
type Settings = { speed: number; playing: boolean; aircraft: Aircraft[]; routes: FeatureCollection<LineString>; aircraftVisible: boolean; labels: boolean; selected: string | null; extrapolate: boolean };
export function animateMapPlanes(map: Map, getSettings: () => Settings) {
  const canvas = document.createElement("canvas");
  canvas.className = "map-motion-canvas"; canvas.dataset.testid = "aircraft-motion"; canvas.setAttribute("aria-hidden", "true");
  map.getContainer().append(canvas);
  const context = canvas.getContext("2d")!;
  const plane = new Path2D("M0 -11 L2 -8 L2 -1 L10 5 L10 7 L2 4 L1 9 L5 11 L5 13 L0 11 L-5 13 L-5 11 L-1 9 L-2 4 L-10 7 L-10 5 L-2 -1 L-2 -8 Z");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, disposed = false, visible = true, hasMotion = false, last = performance.now(), elapsed = 0, hits: Hit[] = [];
  const observations = new globalThis.Map<string, { start: number; longitude: number; latitude: number; updated: number }>();
  function paint() {
    const width = canvas.clientWidth, height = canvas.clientHeight, ratio = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height); hits = [];
    const settings = getSettings(), alive = new Set<string>(); hasMotion = settings.routes.features.length > 0;
    const draw = (x: number, y: number, rotation: number, color: string, size: number, label?: string) => {
      if (x < -25 || x > width + 25 || y < -25 || y > height + 25) return false;
      context.save(); context.translate(x, y); context.rotate(rotation); context.scale(size, size);
      context.fillStyle = color; context.strokeStyle = "#111820"; context.lineWidth = 1.2; context.stroke(plane); context.fill(plane); context.restore();
      if (label) { context.font = "9px monospace"; context.textAlign = "center"; context.lineWidth = 3; context.strokeStyle = "#111820"; context.strokeText(label, x, y + 19); context.fillStyle = color; context.fillText(label, x, y + 19); }
      return true;
    };
    if (settings.aircraftVisible) for (const aircraft of settings.aircraft) {
      alive.add(aircraft.icao24);
      let seen = observations.get(aircraft.icao24);
      if (!seen) { seen = { start: elapsed, longitude: aircraft.longitude, latitude: aircraft.latitude, updated: performance.now() }; observations.set(aircraft.icao24, seen); }
      const now = performance.now(), blend = 1 - Math.exp(-Math.max(0, now - seen.updated) / 800);
      // Ease refreshed feed anchors without restarting the animation or jumping across the date line.
      seen.longitude += (((aircraft.longitude - seen.longitude + 540) % 360) - 180) * blend;
      seen.latitude += (aircraft.latitude - seen.latitude) * blend; seen.updated = now;
      const moving = settings.extrapolate && !aircraft.onGround;
      if (moving) hasMotion = true;
      const anchor: [number, number] = settings.extrapolate ? [seen.longitude, seen.latitude] : [aircraft.longitude, aircraft.latitude];
      const point = map.project(anchor);
      const heading = aircraft.heading ?? 0;
      const ahead = map.project(motionPosition({ ...aircraft, longitude: anchor[0], latitude: anchor[1], heading, onGround: false, velocity: 200 }, 1));
      let angle = Math.atan2(ahead.x - point.x, -(ahead.y - point.y));
      if (moving && !reduced.matches) {
        const offset = visualFlightOffset(elapsed - seen.start, angle * 180 / Math.PI);
        point.x += offset.x; point.y += offset.y; angle = offset.rotation;
      }
      const location = map.unproject(point), coordinate: [number, number] = [location.lng, location.lat];
      const color = aircraft.icao24 === settings.selected ? "#77d7e5" : aircraft.onGround ? "#717985" : "#d4dae2";
      if (draw(point.x, point.y, angle, color, .5 + Math.min(map.getZoom(), 10) * .025, settings.labels ? aircraft.callsign || undefined : undefined)) hits.push({ id: aircraft.icao24, coordinates: coordinate, x: point.x, y: point.y });
    }
    for (const id of observations.keys()) if (!alive.has(id)) observations.delete(id);
    settings.routes.features.forEach((route, index) => {
      const coordinates = route.geometry.coordinates; if (coordinates.length < 2) return;
      const from = map.project(coordinates[0] as [number, number]), to = map.project(coordinates[coordinates.length - 1] as [number, number]);
      const progress = reduced.matches ? .5 : (elapsed / 24 + index * .173) % 1;
      draw(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress, Math.atan2(to.x - from.x, -(to.y - from.y)), String(route.properties?.color || "#92a4ba"), .75);
    });
  }
  function advance(now: number) {
    const settings = getSettings();
    if (!document.hidden && visible && !reduced.matches && settings.playing) elapsed += Math.min(.1, Math.max(0, (now - last) / 1000)) * settings.speed;
    last = now;
  }
  function schedule() {
    if (!frame && !disposed && !document.hidden && visible && !reduced.matches && getSettings().playing && hasMotion) frame = requestAnimationFrame(tick);
  }
  function tick(now: number) {
    frame = 0; if (disposed) return;
    advance(now); paint(); schedule();
  }
  function refresh() {
    if (disposed) return;
    advance(performance.now()); paint(); schedule();
  }
  const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; refresh(); }); observer.observe(canvas);
  map.on("move", refresh); map.on("resize", refresh); document.addEventListener("visibilitychange", refresh); reduced.addEventListener("change", refresh);
  refresh();
  return { refresh, pick: (point: { x: number; y: number }) => hits.find(hit => Math.hypot(hit.x - point.x, hit.y - point.y) < 13), destroy: () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); map.off("move", refresh); map.off("resize", refresh); document.removeEventListener("visibilitychange", refresh); reduced.removeEventListener("change", refresh); canvas.remove(); } };
}
