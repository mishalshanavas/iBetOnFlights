import { distanceKm } from "./geo";
export type Coordinate = [number, number];

export function routeLength(coordinates: Coordinate[]) {
  return coordinates.slice(1).reduce((total, point, index) => total + distanceKm(coordinates[index][1], coordinates[index][0], point[1], point[0]), 0);
}

/** Follow all supplied waypoints by distance; finish exactly at the destination. */
export function routePosition(coordinates: Coordinate[], progress: number): Coordinate {
  if (!coordinates.length) throw new Error("A flight path needs coordinates");
  if (progress <= 0 || coordinates.length === 1) return [...coordinates[0]];
  if (progress >= 1) return [...coordinates[coordinates.length - 1]];
  const lengths = coordinates.slice(1).map((point, index) => distanceKm(coordinates[index][1], coordinates[index][0], point[1], point[0]));
  let remaining = lengths.reduce((a, b) => a + b, 0) * progress;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (remaining <= length && length > 0) {
      const from = coordinates[index], to = coordinates[index + 1], fraction = remaining / length;
      const longitude = from[0] + (((to[0] - from[0] + 540) % 360) - 180) * fraction;
      // Match the Mercator route line rendered by the map, including intermediate waypoints.
      const mercator = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, latitude)) * Math.PI / 360));
      const latitude = (2 * Math.atan(Math.exp(mercator(from[1]) + (mercator(to[1]) - mercator(from[1])) * fraction)) - Math.PI / 2) * 180 / Math.PI;
      return [((longitude + 540) % 360) - 180, latitude];
    }
    remaining -= length;
  }
  return [...coordinates[coordinates.length - 1]];
}

/** A time-compressed route preview, not a flight's real arrival time. */
export function previewDuration(coordinates: Coordinate[]) {
  return Math.max(40, Math.min(180, routeLength(coordinates) / 12));
}
