export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const h = Math.sin((lat2-lat1)*r/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lon2-lon1)*r/2)**2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0,1-h)));
}
export const feet = (m: number | null) => m === null ? "—" : Math.round(m * 3.28084).toLocaleString();
export const knots = (ms: number | null) => ms === null ? "—" : Math.round(ms * 1.943844).toString();
