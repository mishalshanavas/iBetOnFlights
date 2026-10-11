import { and,asc,eq,gte,isNotNull,lt,lte,sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { flightPredictionEvidence,flights } from "@/lib/db/schema";
import { ProviderError } from "@/lib/providers/base";
import { itineraryInput } from "./itinerary";
import { estimateDelay,summarizeDelays,type DelayGroup } from "./empirical";
import { publishedHistoryStatus,publishedRisk,publishedRouteBoard } from "./published-service";

const LOOKBACK_SECONDS=365*86400,CACHE_MS=5*60*1000;
let pending:{expires:number;promise:Promise<Awaited<ReturnType<typeof collectHistory>>>}|null=null;
async function collectHistory(){
  const asOf=Math.floor(Date.now()/1000),db=await getDb();
  const rows=await db.select({origin:flights.originIcao,destination:flights.destinationIcao,operatingAirline:flights.operatingAirline,
    total:sql<number>`count(*)`,over30:sql<number>`sum(case when ${flights.actualArrival}-${flights.scheduledArrival} >= 1800 then 1 else 0 end)`,
    over60:sql<number>`sum(case when ${flights.actualArrival}-${flights.scheduledArrival} >= 3600 then 1 else 0 end)`,
    over180:sql<number>`sum(case when ${flights.actualArrival}-${flights.scheduledArrival} >= 10800 then 1 else 0 end)`})
    .from(flights).innerJoin(flightPredictionEvidence,eq(flights.id,flightPredictionEvidence.flightId))
    .where(and(gte(flights.scheduledDeparture,asOf-LOOKBACK_SECONDS),lt(flights.scheduledDeparture,asOf-3600),
      isNotNull(flights.actualArrival),isNotNull(flights.operatingAirline),
      eq(flightPredictionEvidence.arrivalTimeBasis,"gate"),isNotNull(flightPredictionEvidence.labelObservedAt),
      lte(flightPredictionEvidence.labelObservedAt,asOf),
      sql`${flightPredictionEvidence.scheduleObservedAt} <= ${flights.scheduledDeparture} - 3600`,
      sql`${flightPredictionEvidence.labelObservedAt} >= ${flights.actualArrival}`,
      sql`lower(${flights.status}) not in ('cancelled','canceled','diverted','c','d')`))
    .groupBy(flights.originIcao,flights.destinationIcao,flights.operatingAirline);
  const groups:DelayGroup[]=rows.map(r=>({origin:r.origin,destination:r.destination,operatingAirline:r.operatingAirline!.trim().toUpperCase(),
    total:Number(r.total),over30:Number(r.over30),over60:Number(r.over60),over180:Number(r.over180)}));
  return {asOf,summary:summarizeDelays(groups)};
}
async function history(){
  if(pending&&pending.expires>Date.now())return pending.promise;
  const job=collectHistory().catch(e=>{pending=null;throw e;});
  pending={expires:Date.now()+CACHE_MS,promise:job};return job;
}
export function clearRiskHistoryCache(){pending=null;}
export async function riskStatus(){
  const [{asOf,summary},publishedHistory]=await Promise.all([history(),publishedHistoryStatus()]),total=summary.global.total,severe=summary.global.over180;
  const gateHistoryAvailable=total>=1000&&severe>=10;
  return {available:gateHistoryAvailable||publishedHistory.available,gateHistoryAvailable,publishedHistory,
    method:gateHistoryAvailable?"empirical-history-v1":publishedHistory.available?"caa-published-punctuality-v1":"empirical-history-v1",asOf,
    sampleSize:total,severeDelayCount:severe,minimumSamples:1000,minimumSevereDelays:10,
    lookbackDays:365,message:gateHistoryAvailable?undefined:publishedHistory.available?"Official CAA route punctuality is available for covered UK-linked routes. Individual flight history is insufficient.":`Need sourced flight history or a supported CAA route cohort. Found ${total} gate-arrival records and ${publishedHistory.aggregateRecords} published aggregates.`,
    limitations:"Historical arrival delay is not a compensation claim or a validated individual-flight forecast."};
}
export async function predictRisk(raw:unknown){
  const input=itineraryInput.parse(raw),now=Math.floor(Date.now()/1000);
  if(input.scheduledDeparture<now+3600)throw new ProviderError("TOO_LATE","This estimate requires at least one hour before departure.",422);
  return riskForRoute(input);
}
/** The empirical estimator uses route and airline only; no arrival time is fabricated for public airport boards. */
export async function riskForRoute(input:{origin:string;destination:string;operatingAirline:string}){
  const now=Math.floor(Date.now()/1000),{asOf,summary}=await history(),estimate=estimateDelay(summary,input);
  if(!estimate){
    const published=await publishedRisk(input);if(published)return published;
    throw new ProviderError("INSUFFICIENT_HISTORY","No supported CAA route-and-airline cohort (minimum 100 matched movements), or sufficient individual gate-arrival history, is available.",503);
  }
  return {...estimate,asOf,predictedAt:now,direction:"arrival",predictionType:"empirical_historical_rate",target:"30, 60, and 180+ minute delay at destination gate",
    source:"Imported historical gate-arrival records",limitations:"Empirical estimate, not a calibrated individual-flight forecast. Cancellations, diversions, and compensation eligibility are excluded."};
}
export const batchRiskInput=z.object({flights:z.array(itineraryInput).min(1).max(100)}).strict();
export async function predictRiskBatch(raw:unknown){
  const input=batchRiskInput.parse(raw),snapshot=await history();
  const predictions=await Promise.all(input.flights.map(async(flight,index)=>{
    try{
      if(flight.scheduledDeparture<Math.floor(Date.now()/1000)+3600)throw new ProviderError("TOO_LATE","This estimate requires at least one hour before departure.",422);
      const estimate=estimateDelay(snapshot.summary,flight)||await publishedRisk(flight);
      if(!estimate)throw new ProviderError("INSUFFICIENT_HISTORY","The historical sample is too small for a rate.",503);
      return {index,flight,prediction:{...estimate,asOf:snapshot.asOf,target:"target" in estimate?estimate.target:"arrival delay at destination gate"},error:null};
    }catch(e){return {index,flight,prediction:null,error:e instanceof ProviderError?{code:e.code,message:e.message}:{code:"PREDICTION_UNAVAILABLE",message:"Estimate unavailable."}};}
  }));
  return {predictions,status:await riskStatus()};
}
export async function upcomingFlightPredictions(rawLimit:unknown=50){
  const limit=z.coerce.number().int().min(1).max(100).parse(rawLimit),now=Math.floor(Date.now()/1000),db=await getDb();
  const snapshot=await history(),status=await riskStatus();
  const records=await db.select({flight:flights,evidence:flightPredictionEvidence}).from(flights)
    .leftJoin(flightPredictionEvidence,eq(flights.id,flightPredictionEvidence.flightId))
    .where(and(gte(flights.scheduledDeparture,now+3600),lte(flights.scheduledDeparture,now+30*86400)))
    .orderBy(asc(flights.scheduledDeparture)).limit(500);
  const items=await Promise.all(records.map(async({flight,evidence})=>{
    if(!evidence||evidence.scheduleObservedAt>now)return {flight,evidence,prediction:null,error:{code:"UNVERIFIED_SCHEDULE",message:"No timestamped schedule evidence is available."}};
    if(!flight.operatingAirline)return {flight,evidence,prediction:null,error:{code:"MISSING_AIRLINE",message:"Operating airline is required."}};
    const itinerary={origin:flight.originIcao,destination:flight.destinationIcao,operatingAirline:flight.operatingAirline.trim().toUpperCase()};
    const prediction=estimateDelay(snapshot.summary,itinerary)||await publishedRisk(itinerary);
    return {flight,evidence,prediction,error:prediction?null:{code:"INSUFFICIENT_HISTORY",message:"Historical gate-arrival sample is too small."}};
  }));
  items.sort((a,b)=>(b.prediction?.probability180??-1)-(a.prediction?.probability180??-1)||a.flight.scheduledDeparture-b.flight.scheduledDeparture);
  return {flights:items.slice(0,limit),publishedRoutes:await publishedRouteBoard(30),examined:records.length,status,asOf:snapshot.asOf,
    source:"First 500 upcoming imported schedules; rates from sourced gate arrivals or CAA published cohorts",
    limitations:"Check each rate's source, reporting airport, and arrival/departure direction. Historical punctuality does not establish compensation eligibility."};
}
