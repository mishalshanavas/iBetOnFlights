import { and, eq, lt, desc, asc, sql, inArray } from "drizzle-orm";
import { getDb } from "./index";
import * as t from "./schema";
import type { Aircraft, AircraftResponse, WeatherResponse } from "@/lib/types";
import { distanceKm } from "@/lib/aviation/geo";
import { europeanAirports, findAirport } from "@/data/airports";
export const now = () => Math.floor(Date.now()/1000);

export async function readCache<T>(key:string):Promise<T|null> {
  const db=await getDb(); const [row]=await db.select().from(t.cache).where(and(eq(t.cache.key,key),sql`${t.cache.expiresAt} > ${now()}`));
  return row ? JSON.parse(row.value) as T : null;
}
export async function writeCache(key:string,value:unknown,seconds:number) {
  const db=await getDb();await db.insert(t.cache).values({key,value:JSON.stringify(value),expiresAt:now()+seconds}).onConflictDoUpdate({target:t.cache.key,set:{value:JSON.stringify(value),expiresAt:now()+seconds}});
}
export async function recordAircraft(data:AircraftResponse) {
  if(data.source.status==="demo" || !data.source.observedAt) return;
  const db=await getDb();
  return db.transaction(async tx=>{
    await tx.insert(t.snapshots).values({region:data.region,observedAt:data.source.observedAt!,count:data.aircraft.length}).onConflictDoNothing();
    const [snapshot]=await tx.select().from(t.snapshots).where(and(eq(t.snapshots.region,data.region),eq(t.snapshots.observedAt,data.source.observedAt!)));
    for(let i=0;i<data.aircraft.length;i+=40) {
      const chunk=data.aircraft.slice(i,i+40);
      await tx.insert(t.positions).values(chunk.map(a=>({snapshotId:snapshot.id,icao24:a.icao24,callsign:a.callsign,latitude:a.latitude,longitude:a.longitude,altitudeM:a.baroAltitude,groundSpeedMs:a.velocity,headingDeg:a.heading,verticalRateMs:a.verticalRate,onGround:a.onGround,observedAt:a.timePosition??a.lastContact,ingestedAt:now(),source:"OpenSky Network",data:JSON.stringify(a)}))).onConflictDoNothing();
      await tx.insert(t.aircraftTable).values(chunk.map(a=>({icao24:a.icao24,lastSeen:a.lastContact}))).onConflictDoUpdate({target:t.aircraftTable.icao24,set:{lastSeen:sql`excluded.lastSeen`}});
    }
    const cutoff=now()-Math.min(168,Math.max(1,Number(process.env.POSITION_RETENTION_HOURS)||48))*3600;
    const expired=await tx.select({id:t.snapshots.id}).from(t.snapshots).where(lt(t.snapshots.observedAt,cutoff));
    if(expired.length){await tx.delete(t.positions).where(inArray(t.positions.snapshotId,expired.map(s=>s.id)));await tx.delete(t.snapshots).where(lt(t.snapshots.observedAt,cutoff));}
    await tx.delete(t.cache).where(lt(t.cache.expiresAt,now()-3600));
    await tx.insert(t.dataSources).values({id:"opensky",providerName:"OpenSky Network",sourceType:"surveillance",lastSuccessAt:now(),accessStatus:"recent"}).onConflictDoUpdate({target:t.dataSources.id,set:{lastSuccessAt:now(),accessStatus:"recent",message:null}});
    return snapshot.id;
  });
}
export async function getSnapshots(region:string,date?:string) {
  const db=await getDb(); const start=date?Date.parse(`${date}T00:00:00Z`)/1000:now()-86400;
  const end=date?start+86400:now()+1;
  return db.select().from(t.snapshots).where(and(eq(t.snapshots.region,region),sql`${t.snapshots.observedAt} >= ${start}`,sql`${t.snapshots.observedAt} < ${end}`)).orderBy(asc(t.snapshots.observedAt)).limit(1000);
}
export async function getSnapshot(id:number) {
  const db=await getDb();const [snapshot]=await db.select().from(t.snapshots).where(eq(t.snapshots.id,id));
  if(!snapshot)return null;
  const rows=await db.select({data:t.positions.data}).from(t.positions).where(eq(t.positions.snapshotId,id));
  return {snapshot,aircraft:rows.map(r=>JSON.parse(r.data) as Aircraft)};
}
export async function getTrack(id:string) {
  const db=await getDb();const rows=await db.select({data:t.positions.data,observedAt:t.positions.observedAt}).from(t.positions).where(eq(t.positions.icao24,id)).orderBy(desc(t.positions.observedAt)).limit(180);
  const unique=new Map(rows.map(r=>[r.observedAt,JSON.parse(r.data) as Aircraft]));return [...unique.values()].reverse();
}
export async function airportAnalytics(icao?:string) {
  const db=await getDb();const recent=await db.select().from(t.snapshots).orderBy(desc(t.snapshots.observedAt)).limit(180);
  const selected=icao?findAirport(icao):null;
  const counts=new Map<number,number>();
  if(selected&&recent.length){
    // One bounded query replaces a query for every historical snapshot.
    const latDelta=80/110,lonDelta=80/(110*Math.max(0.1,Math.cos(selected.latitude*Math.PI/180)));
    const rows=await db.select({snapshotId:t.positions.snapshotId,latitude:t.positions.latitude,longitude:t.positions.longitude}).from(t.positions).where(and(inArray(t.positions.snapshotId,recent.map(s=>s.id)),sql`${t.positions.latitude} BETWEEN ${selected.latitude-latDelta} AND ${selected.latitude+latDelta}`,sql`${t.positions.longitude} BETWEEN ${selected.longitude-lonDelta} AND ${selected.longitude+lonDelta}`));
    for(const p of rows)if(distanceKm(selected.latitude,selected.longitude,p.latitude,p.longitude)<=75)counts.set(p.snapshotId,(counts.get(p.snapshotId)||0)+1);
  }
  const points=[...recent].reverse().map(s=>({time:s.observedAt,count:selected?counts.get(s.id)||0:s.count,region:s.region}));
  return {points,sampleSize:points.length,source:"Recorded OpenSky observations",coverage:icao||"Selected collection regions",definition:selected?"Aircraft observed within 75 km; proximity does not establish arrival intent.":"Retrieved aircraft per regional snapshot; not total European flights.",airports:europeanAirports};
}
export async function recordWeather(w:WeatherResponse) {
  const db=await getDb();const p=w.current;
  await db.insert(t.weather).values({airportIcao:w.airport,validAt:p.validAt,temperatureC:p.temperature,windSpeedMs:p.windSpeed,windDirection:p.windDirection,windGustMs:p.windGust,precipitationMm:p.precipitation,visibilityM:p.visibility,cloudCoverPct:p.cloudCover,pressureHpa:p.pressure,forecastIssuedAt:null,forecastRetrievedAt:w.source.retrievedAt,ingestedAt:now(),source:"Open-Meteo forecast",data:JSON.stringify(p)}).onConflictDoNothing();
  await db.delete(t.weather).where(lt(t.weather.ingestedAt,now()-7*86400));
  await db.insert(t.dataSources).values({id:"open-meteo",providerName:"Open-Meteo",sourceType:"forecast",lastSuccessAt:now(),accessStatus:"recent"}).onConflictDoUpdate({target:t.dataSources.id,set:{lastSuccessAt:now(),accessStatus:"recent",message:null}});
}
