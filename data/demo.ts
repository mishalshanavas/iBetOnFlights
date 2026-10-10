import type { Aircraft } from "@/lib/types";
import { regions, type RegionId } from "@/lib/aviation/regions";
// Deterministic fixtures. Never persisted or returned by the live provider.
export function demoAircraft(region: RegionId): Aircraft[] {
  const [west,south,east,north] = regions[region].bounds;
  let seed = 4187;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({length:128},(_,i) => ({
    icao24:(0xd00000+i).toString(16),callsign:`DEMO${String(i+1).padStart(3,"0")}`,
    originCountry:null,latitude:south+(north-south)*random(),longitude:west+(east-west)*random(),
    baroAltitude: i%16===0 ? 0 : 2500+random()*9300, geoAltitude:null,
    velocity:i%16===0 ? 8 : 145+random()*100,heading:random()*360,verticalRate:0,
    onGround:i%16===0,timePosition:1791716400,lastContact:1791716400,
    squawk:null,spi:false,positionSource:null
  }));
}
