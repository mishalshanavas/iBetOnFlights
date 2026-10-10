import { describe,it,expect,beforeAll,afterAll,vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as t from "@/lib/db/schema";
import { recordAircraft,getSnapshots,getSnapshot,getTrack,airportAnalytics,now } from "@/lib/db/repository";
import { demoAircraft } from "@/data/demo";
import { clearRiskHistoryCache,predictRisk,riskStatus,upcomingFlightPredictions } from "@/lib/predictions/schedule-service";
import { itineraryContext } from "@/lib/predictions/weather-context";
import { openMeteo } from "@/lib/providers/weather";
import { clearPublishedHistoryCache } from "@/lib/predictions/published-service";
import type { AircraftResponse } from "@/lib/types";
const testFile=join(tmpdir(),`flightguard-test-${randomUUID()}.db`);
beforeAll(()=>{process.env.DATABASE_URL=`file:${testFile.replace(/\\/g,"/")}`;});
afterAll(async()=>{(await getDb()).$client.close();try{await rm(testFile,{force:true});}catch{/* Windows may retain the native SQLite handle until the isolated test worker exits. */}});
describe("SQLite persistence",()=>{
  it("keeps nearby counts and chronological ordering when history is fetched together",async()=>{
    const at=now()-60,fixture=demoAircraft("british-isles")[0];
    const near={...fixture,icao24:"test01",latitude:51.47,longitude:-0.46,timePosition:at,lastContact:at};
    const far={...fixture,icao24:"test02",latitude:48.85,longitude:2.35,timePosition:at,lastContact:at};
    for(const [offset,aircraft] of [[0,[near,far]],[10,[far]]] as const)await recordAircraft({aircraft:[...aircraft],region:"british-isles",pollSeconds:120,quotaRemaining:null,source:{provider:"test fixture",status:"recent",observedAt:at+offset,retrievedAt:at+offset}});
    const result=await airportAnalytics("EGLL");
    expect(result.points.filter(p=>p.time===at||p.time===at+10).map(p=>({time:p.time,count:p.count}))).toEqual([{time:at,count:1},{time:at+10,count:0}]);
    const all=await airportAnalytics();expect(all.points.find(p=>p.time===at)?.count).toBe(2);
  });
  it("migrates and seeds airport metadata",async()=>{const db=await getDb();const rows=await db.select().from(t.airportsTable);expect(rows.length).toBeGreaterThanOrEqual(22);});
  it("deduplicates snapshots and preserves aircraft observations",async()=>{const a=demoAircraft("benelux")[0];a.timePosition=now();a.lastContact=now();const data:AircraftResponse={aircraft:[a],region:"benelux",pollSeconds:120,quotaRemaining:null,source:{provider:"test fixture",status:"recent",observedAt:now(),retrievedAt:now()}};const id=await recordAircraft(data);expect(await recordAircraft(data)).toBe(id);const history=await getSnapshots("benelux");expect(history).toHaveLength(1);const snapshot=await getSnapshot(id!);expect(snapshot?.aircraft).toHaveLength(1);expect((await getTrack(a.icao24))[0].latitude).toBe(a.latitude);});
  it("never records demo mode positions",async()=>{const response:AircraftResponse={aircraft:demoAircraft("iberia"),region:"iberia",pollSeconds:120,quotaRemaining:null,source:{provider:"fixtures",status:"demo",observedAt:now(),retrievedAt:now()}};await recordAircraft(response);expect(await getSnapshots("iberia")).toHaveLength(0);});
  it("creates and deletes watches without duplicate targets",async()=>{const db=await getDb();await db.insert(t.watchlists).values({targetType:"airport",targetId:"EGLL",createdAt:now()}).onConflictDoNothing();await db.insert(t.watchlists).values({targetType:"airport",targetId:"EGLL",createdAt:now()}).onConflictDoNothing();expect(await db.select().from(t.watchlists)).toHaveLength(1);await db.delete(t.watchlists).where(eq(t.watchlists.targetId,"EGLL"));expect(await db.select().from(t.watchlists)).toHaveLength(0);});
  it("persists sourced schedules and model version with predictions",async()=>{const db=await getDb();await db.insert(t.flights).values({id:"test-flight",flightNumber:"TEST123",originIcao:"EHAM",destinationIcao:"EDDF",scheduledDeparture:now(),scheduledArrival:now()+3600,status:"test fixture",source:"test fixture",updatedAt:now()});const [f]=await db.select().from(t.flights).where(eq(t.flights.id,"test-flight"));expect(f.destinationIcao).toBe("EDDF");await db.insert(t.predictions).values({flightId:f.id,modelVersion:"test-model",predictedAt:now(),probability30:0.5,probability60:0.2,probability180:0.01,featureSnapshotJson:"{}"});expect((await db.select().from(t.predictions))[0].modelVersion).toBe("test-model");});
  it("serves published route rates without inventing individual gate-arrival records",async()=>{
    const db=await getDb(),current=now(),month=new Date();month.setUTCDate(1);month.setUTCMonth(month.getUTCMonth()-1);
    const period=`${month.getUTCFullYear()}${String(month.getUTCMonth()+1).padStart(2,"0")}`;
    await db.insert(t.publishedPunctuality).values({id:"caa-test-fixture",period,reportingAirport:"EGLL",otherAirport:"EHAM",airline:"KLM",direction:"D",matched:200,unmatched:10,cancelled:20,late30:40,late60:20,late180:4,averageDelay:12,sourceUrl:"https://www.caa.co.uk/test-fixture",sourceRunDate:"test fixture",retrievedAt:current-60});
    clearRiskHistoryCache();clearPublishedHistoryCache();
    try{
      const status=await riskStatus();expect(status.available).toBe(true);expect(status.gateHistoryAvailable).toBe(false);expect(status.sampleSize).toBe(0);
      expect(status.publishedHistory.aggregateRecords).toBe(1);
      const estimate=await predictRisk({origin:"EGLL",destination:"EHAM",operatingAirline:"KL",scheduledDeparture:current+86400,scheduledArrival:current+93600});
      expect(estimate.method).toBe("caa-published-punctuality-v1");expect(estimate.probability180).toBe(.02);expect(estimate.target).toContain("departure");
    }finally{await db.delete(t.publishedPunctuality);clearRiskHistoryCache();clearPublishedHistoryCache();}
  });
  it("calculates Lambda-ready delay rates from timestamped gate arrivals",async()=>{
    const db=await getDb(),current=now();
    for(let start=0;start<1000;start+=50){
      const records=Array.from({length:50},(_,offset)=>{
        const i=start+offset,departure=current-30*86400-i*600,arrival=departure+7200;
        const delay=i<20?200:i<80?70:i<200?40:0;
        return {id:`history-${i}`,flightNumber:`T${i}`,operatingAirline:"TEST",originIcao:"EHAM",destinationIcao:"EDDF",scheduledDeparture:departure,scheduledArrival:arrival,actualArrival:arrival+delay*60,status:"arrived",source:"test fixture",updatedAt:arrival+delay*60+300};
      });
      await db.insert(t.flights).values(records);
      await db.insert(t.flightPredictionEvidence).values(records.map(f=>({flightId:f.id,scheduleObservedAt:f.scheduledDeparture-7200,labelObservedAt:f.actualArrival!+300,arrivalTimeBasis:"gate"})));
    }
    clearRiskHistoryCache();
    expect((await riskStatus()).available).toBe(true);
    const input={origin:"EHAM",destination:"EDDF",operatingAirline:"TEST",scheduledDeparture:current+86400,scheduledArrival:current+93600};
    const estimate=await predictRisk(input);
    expect(estimate.cohort).toBe("route_and_airline");
    expect(estimate.cohortSamples).toBe(1000);
    expect(estimate.probability180).toBeCloseTo(.02);
    await db.insert(t.flights).values({id:"future-flight",flightNumber:"T2000",operatingAirline:"TEST",originIcao:"EHAM",destinationIcao:"EDDF",scheduledDeparture:input.scheduledDeparture,scheduledArrival:input.scheduledArrival,status:"scheduled",source:"test fixture",updatedAt:current});
    await db.insert(t.flightPredictionEvidence).values({flightId:"future-flight",scheduleObservedAt:current-3600,arrivalTimeBasis:"unknown"});
    const board=await upcomingFlightPredictions(5);
    expect(board.flights.find(item=>item.flight.id==="future-flight")?.prediction?.probability180).toBeCloseTo(.02);
    const weatherPoint=(at:number)=>({validAt:new Date(at*1000).toISOString(),temperature:18,humidity:60,windSpeed:12,windDirection:180,windGust:20,precipitation:4,cloudCover:70,pressure:1010,visibility:9000,code:3});
    const source={provider:"test forecast",status:"recent" as const,observedAt:current,retrievedAt:current};
    const mock=vi.spyOn(openMeteo,"fetch").mockImplementation(async airport=>({airport,current:weatherPoint(current),hourly:[weatherPoint(input.scheduledDeparture),weatherPoint(input.scheduledArrival)],source}));
    try{
      const context=await itineraryContext({itinerary:input,thresholds:{gustMs:18,precipitationMm:3}});
      expect(context.prediction?.probability180).toBeCloseTo(.02);
      expect(context.weather.departure.alerts).toEqual(["gust_threshold","precipitation_threshold"]);
      expect(context.weather.arrival.status).toBe("available");
      expect(context.operationalNotices.status).toBe("unavailable");
    }finally{mock.mockRestore();}
  });
});
