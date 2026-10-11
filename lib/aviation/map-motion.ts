import type { Map } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import type { Aircraft } from "@/lib/types";
import { previewDuration, routePosition, type Coordinate } from "./flight-path";

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
type Settings = { speed: number; playing: boolean; aircraft: Aircraft[]; routes: FeatureCollection<LineString>; aircraftVisible: boolean; labels: boolean; selected: string | null; extrapolate: boolean };
export function animateMapPlanes(map: Map, getSettings: () => Settings) {
  const canvas = document.createElement("canvas");
  canvas.className = "map-motion-canvas"; canvas.dataset.testid = "aircraft-motion"; canvas.setAttribute("aria-hidden", "true");
  map.getContainer().append(canvas);
  const context = canvas.getContext("2d")!;
  const plane = new Path2D("M0 -11 L2 -8 L2 -1 L10 5 L10 7 L2 4 L1 9 L5 11 L5 13 L0 11 L-5 13 L-5 11 L-1 9 L-2 4 L-10 7 L-10 5 L-2 -1 L-2 -8 Z");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, disposed = false, visible = true, hasMotion = false, last = performance.now(), elapsed = 0, hits: Hit[] = [];
  const observations = new globalThis.Map<string, { stamp: number; start: number; longitude: number; latitude: number; updated: number }>();
  const routeClocks = new globalThis.Map<string, { signature: string; start: number }>();
  function paint() {
    const width = canvas.clientWidth, height = canvas.clientHeight, ratio = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height); hits = [];
    const settings = getSettings(), alive = new Set<string>(); hasMotion = false;
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
      const stamp = aircraft.timePosition ?? aircraft.lastContact;
      if (!seen) { seen = { stamp, start: elapsed, longitude: aircraft.longitude, latitude: aircraft.latitude, updated: performance.now() }; observations.set(aircraft.icao24, seen); }
      if (seen.stamp !== stamp) { seen.stamp = stamp; seen.start = elapsed; }
      const now = performance.now(), blend = 1 - Math.exp(-Math.max(0, now - seen.updated) / 800);
      const route = aircraft.animationRoute;
      const flightSeconds = reduced.matches || !settings.extrapolate ? 0 : elapsed - seen.start;
      const progress = route ? Math.min(1, route.progress + flightSeconds / Math.max(1, route.durationSeconds)) : 0;
      const landed = Boolean(route && progress >= 1);
      const target = route && !aircraft.onGround && settings.extrapolate ? routePosition(route.coordinates, progress) : motionPosition(aircraft, flightSeconds);
      // Ease fresh observations into the estimated position. Never fabricate a live destination.
      seen.longitude += (((target[0] - seen.longitude + 540) % 360) - 180) * blend;
      seen.latitude += (target[1] - seen.latitude) * blend; seen.updated = now;
      const moving = settings.extrapolate && !aircraft.onGround && (route ? !landed : aircraft.heading !== null && (aircraft.velocity ?? 0) > 0 && flightSeconds < 120);
      if (moving || (!route && settings.extrapolate && (Math.abs(seen.latitude - target[1]) > .000001 || Math.abs((((target[0] - seen.longitude + 540) % 360) - 180)) > .000001))) hasMotion = true;
      const anchor: Coordinate = route || !settings.extrapolate ? target : [seen.longitude, seen.latitude];
      const point = map.project(anchor);
      const heading = aircraft.heading ?? 0;
      const ahead = map.project(route ? routePosition(route.coordinates, Math.min(1, progress + .001)) : motionPosition({ ...aircraft, longitude: anchor[0], latitude: anchor[1], heading, onGround: false, velocity: 200 }, 1));
      const behind = route ? map.project(routePosition(route.coordinates, Math.max(0, progress - .001))) : point;
      const angle = Math.atan2(ahead.x - behind.x, -(ahead.y - behind.y));
      if (route && aircraft.icao24 === settings.selected) {
        context.beginPath(); route.coordinates.forEach((coordinate, index) => { const p = map.project(coordinate); if (index) context.lineTo(p.x, p.y); else context.moveTo(p.x, p.y); });
        context.strokeStyle = "#77d7e5"; context.lineWidth = 1; context.stroke();
      }
      const color = aircraft.icao24 === settings.selected ? "#77d7e5" : aircraft.onGround || landed ? "#717985" : "#d4dae2";
      const label = settings.labels ? landed ? `${aircraft.callsign || ""} / ${route?.destinationIcao} arrived (demo)` : aircraft.callsign || undefined : undefined;
      if (draw(point.x, point.y, angle, color, (.5 + Math.min(map.getZoom(), 10) * .025) * (landed ? .7 : 1), label)) hits.push({ id: aircraft.icao24, coordinates: anchor, x: point.x, y: point.y });
    }
    for (const id of observations.keys()) if (!alive.has(id)) observations.delete(id);
    const activeRoutes = new Set<string>();
    settings.routes.features.forEach((route, index) => {
      const coordinates = route.geometry.coordinates; if (coordinates.length < 2) return;
      if (route.properties?.cancelled) return;
      const id = String(route.properties?.id ?? index), signature = JSON.stringify(coordinates); activeRoutes.add(id);
      let clock = routeClocks.get(id);
      if (!clock || clock.signature !== signature) { clock = { signature, start: elapsed }; routeClocks.set(id, clock); }
      const path = coordinates as Coordinate[], duration = Number(route.properties?.animationDurationSeconds) || previewDuration(path);
      const progress = reduced.matches ? 0 : Math.min(1, (elapsed - clock.start) / Math.max(1, duration));
      if (progress < 1) hasMotion = true;
      const point = map.project(routePosition(path, progress)), before = map.project(routePosition(path, Math.max(0, progress - .001))), ahead = map.project(routePosition(path, Math.min(1, progress + .001)));
      draw(point.x, point.y, Math.atan2(ahead.x - before.x, -(ahead.y - before.y)), progress >= 1 ? "#717985" : String(route.properties?.color || "#92a4ba"), progress >= 1 ? .5 : .75, progress >= 1 ? `${route.properties?.destinationIcao || "Destination"} / arrived (preview)` : undefined);
    });
    for (const id of routeClocks.keys()) if (!activeRoutes.has(id)) routeClocks.delete(id);
  }
  function advance(now: number) {
    const settings = getSettings();
    if (!document.hidden && visible && !reduced.matches && settings.playing) elapsed += Math.max(0, (now - last) / 1000) * settings.speed;
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
  const resume = () => { last = performance.now(); refresh(); };
  const observer = new IntersectionObserver(entries => { const next = entries[0]?.isIntersecting ?? true; if (next !== visible) { visible = next; resume(); } }); observer.observe(canvas);
  map.on("move", refresh); map.on("resize", refresh); document.addEventListener("visibilitychange", resume); reduced.addEventListener("change", resume);
  refresh();
  return { refresh, pick: (point: { x: number; y: number }) => hits.find(hit => Math.hypot(hit.x - point.x, hit.y - point.y) < 13), destroy: () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); map.off("move", refresh); map.off("resize", refresh); document.removeEventListener("visibilitychange", resume); reduced.removeEventListener("change", resume); canvas.remove(); } };
}
