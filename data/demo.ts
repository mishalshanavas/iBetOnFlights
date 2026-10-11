import type { Aircraft } from "@/lib/types";
import { regions, type RegionId } from "@/lib/aviation/regions";
import { airports } from "@/data/airports";
import { previewDuration, routePosition, type Coordinate } from "@/lib/aviation/flight-path";
// Deterministic fixtures. Never persisted or returned by the live provider.
export function demoAircraft(region: RegionId): Aircraft[] {
  const [west,south,east,north] = regions[region].bounds;
  let seed = 4187;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const localAirports = airports.filter(a => a.longitude >= west && a.longitude <= east && a.latitude >= south && a.latitude <= north);
  const connections = localAirports.length >= 2 ? localAirports : airports.slice(0, 4);
  return Array.from({length:128},(_,i) => {
    const origin = connections[i % connections.length], destination = connections[(i % connections.length + 1 + Math.floor(i / connections.length) % (connections.length - 1)) % connections.length];
    const coordinates: Coordinate[] = [[origin.longitude, origin.latitude], [destination.longitude, destination.latitude]];
    const progress = i % 16 === 0 ? 0 : random() * .65;
    const [longitude, latitude] = routePosition(coordinates, progress);
    return {
    icao24:(0xd00000+i).toString(16),callsign:`DEMO${String(i+1).padStart(3,"0")}`,
    originCountry:null,latitude,longitude,
    baroAltitude: i%16===0 ? 0 : 2500+random()*9300, geoAltitude:null,
    velocity:i%16===0 ? 8 : 145+random()*100,heading:(Math.atan2((destination.longitude-origin.longitude)*Math.cos(latitude*Math.PI/180),destination.latitude-origin.latitude)*180/Math.PI+360)%360,verticalRate:0,
    onGround:i%16===0,timePosition:1791716400,lastContact:1791716400,
    squawk:null,spi:false,positionSource:null,
    animationRoute: { coordinates, progress, durationSeconds: Math.min(220, previewDuration(coordinates) * 4), originIcao: origin.icao, destinationIcao: destination.icao, source: "demo" as const },
  }; });
}
