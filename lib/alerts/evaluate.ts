import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { alerts,watchlists } from "@/lib/db/schema";
import { now } from "@/lib/db/repository";
import { openMeteo } from "@/lib/providers/weather";
import { findAirport } from "@/data/airports";
export async function evaluateWatchlists(){
  const db=await getDb();const watched=await db.select().from(watchlists).where(eq(watchlists.targetType,"airport")).limit(10);
  await Promise.allSettled(watched.map(async w=>{
    const a=findAirport(w.targetId);if(!a)return;
    const forecast=await openMeteo.fetch(a.icao);const p=forecast.current;
    const config=JSON.parse(w.settings);const gust=config.gustThresholdMs??18,rain=config.precipitationThresholdMm??3;
    if((p.windGust??0)<gust&&(p.precipitation??0)<rain)return;
    const [recent]=await db.select().from(alerts).where(and(eq(alerts.watchlistId,w.id),gt(alerts.eventTimestamp,now()-3600)));
    if(recent)return;
    await db.insert(alerts).values({watchlistId:w.id,severity:"warning",title:`${a.icao} · forecast threshold reached`,description:`Open-Meteo forecast: gust ${p.windGust??"—"} m/s; precipitation ${p.precipitation??"—"} mm. Valid ${p.validAt}. This is a weather advisory, not a confirmed operational disruption.`,eventTimestamp:now()});
  }));
}
