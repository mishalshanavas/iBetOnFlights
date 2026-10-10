import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { eq,desc,like,or,and } from "drizzle-orm";
import { airports,findAirport } from "@/data/airports";
import { regions,type RegionId } from "@/lib/aviation/regions";
import { opensky,boundsSchema } from "@/lib/providers/opensky";
import { openMeteo } from "@/lib/providers/weather";
import { rainviewer } from "@/lib/providers/radar";
import { notamProvider,metarProvider,eurocontrolProvider } from "@/lib/providers/optional";
import { ProviderError,unsupportedSource,timedFetch } from "@/lib/providers/base";
import { getDb } from "@/lib/db";
import * as t from "@/lib/db/schema";
import { now,getTrack,getSnapshots,getSnapshot,airportAnalytics } from "@/lib/db/repository";
import { evaluateCompensation,assessmentInput } from "@/lib/compensation/engine";
import { modelStatus,predict,predictionInput } from "@/lib/predictions/inference";
import { evaluateWatchlists } from "@/lib/alerts/evaluate";
import { predictRisk,predictRiskBatch,riskStatus,upcomingFlightPredictions } from "@/lib/predictions/schedule-service";
import { itineraryContext } from "@/lib/predictions/weather-context";
export const runtime="nodejs";
export const maxDuration=30;
export const dynamic="force-dynamic";
type Context={params:Promise<{path:string[]}>};
const send=(value:unknown,status=200)=>NextResponse.json(value,{status});
const identifier=z.string().regex(/^[a-f0-9]{6}$/i);
const positiveId=z.coerce.number().int().positive();
async function scheduleApi(path:string,method:"GET"|"POST",body?:unknown){
  const base=process.env.PREDICTION_API_BASE_URL,token=process.env.PREDICTION_API_TOKEN;
  if(!base)return null;
  if(!token)throw new ProviderError("CONFIGURATION_ERROR","Prediction API token is not configured.",503);
  const response=await timedFetch(new URL(path,base.endsWith("/")?base:`${base}/`).toString(),{method,headers:{Authorization:`Bearer ${token}`,...(method==="POST"?{"Content-Type":"application/json"}:{})},body:method==="POST"?JSON.stringify(body):undefined},15000);
  const data=await response.json();
  return send(data,response.status);
}
function regionId(value:string|null){const id=value||"central-europe";if(!(id in regions))throw new ProviderError("INVALID_REGION","Unknown coverage region.",400);return id as RegionId;}
function fail(e:unknown){
  if(e instanceof z.ZodError)return send({error:{code:"INVALID_INPUT",message:e.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}},400);
  if(e instanceof ProviderError)return NextResponse.json({error:{code:e.code,message:e.message,retryAfter:e.retryAfter}},{status:e.status,headers:e.retryAfter?{"Retry-After":String(e.retryAfter)}:undefined});
  return send({error:{code:"SERVICE_UNAVAILABLE",message:"This service is unavailable. Check provider configuration and the database connection."}},503);
}
export async function GET(request:NextRequest,context:Context){
  try{
    const path=(await context.params).path,p=path.join("/"),q=request.nextUrl.searchParams;
    if(p==="aircraft/live"){
      const region=regionId(q.get("region")),bounds=q.has("lamin")?boundsSchema.parse([Number(q.get("lomin")),Number(q.get("lamin")),Number(q.get("lomax")),Number(q.get("lamax"))]):regions[region].bounds;
      return send(await opensky.fetch(region,bounds));
    }
    if(path[0]==="aircraft"&&path[1]){const id=identifier.parse(path[1]).toLowerCase(),track=await getTrack(id);return send(path[2]==="track"?{track,source:"Stored OpenSky observations; no invented trajectory"}:{aircraft:track.at(-1)??null,source:"Recorded OpenSky",schedule:unsupportedSource("Flight identity","Callsign does not confirm a commercial itinerary.")});}
    if(p==="airports"){const term=(q.get("q")||"").toLowerCase();return send({airports:airports.filter(a=>`${a.icao} ${a.iata} ${a.name} ${a.city}`.toLowerCase().includes(term)),source:"Curated airport metadata; coordinates WGS84"});}
    if(path[0]==="airports"&&path[1]){
      const a=findAirport(path[1]);if(!a)return send({error:{message:"Airport not found."}},404);
      if(path[2]==="weather")return send(await openMeteo.fetch(a.icao));
      if(path[2]==="notams")return send(await notamProvider.fetch(a.icao));
      if(path[2]==="traffic")return send(await airportAnalytics(a.icao));
      return send({airport:a,operationalStatus:"Unknown; no official operational status feed",metar:metarProvider});
    }
    if(p==="weather/radar")return send(await rainviewer.fetch());
    if(p==="history") {const date=q.get("date");if(date)z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(date);return send({snapshots:await getSnapshots(regionId(q.get("region")),date||undefined)});}
    if(path[0]==="history"&&path[1]){const result=await getSnapshot(positiveId.parse(path[1]));return result?send(result):send({error:{message:"No recorded history for this interval."}},404);}
    if(p==="flights/search"||p==="flights"){
      const db=await getDb(),search=(q.get("q")||"").slice(0,100);
      const records=await db.select().from(t.flights).where(search?or(like(t.flights.flightNumber,`%${search}%`),like(t.flights.callsign,`%${search}%`),eq(t.flights.originIcao,search.toUpperCase()),eq(t.flights.destinationIcao,search.toUpperCase())):undefined).orderBy(desc(t.flights.scheduledDeparture)).limit(100);
      return send({flights:records,source:records.length?{provider:"Imported verified records",status:"historical",observedAt:Math.max(...records.map(f=>f.updatedAt)),retrievedAt:now()}:unsupportedSource("Flight schedule provider","No verified schedule data available. Search surveillance callsigns separately.")});
    }
    if(path[0]==="flights"&&path[1]){const db=await getDb();const [flight]=await db.select().from(t.flights).where(eq(t.flights.id,path[1]));return flight?send({flight}):send({error:{message:"Verified flight not found."}},404);}
    if(p==="model/status")return send(await modelStatus());
    if(p==="schedule/status"||p==="schedule/model/status")return await scheduleApi("v1/status","GET")||send(await riskStatus());
    if(p==="schedule/flights")return await scheduleApi("v1/flights","GET")||send(await upcomingFlightPredictions(q.get("limit")||50));
    if(p==="analytics/airports")return send(await airportAnalytics(q.get("icao")||undefined));
    if(p==="analytics/routes"){
      const db=await getDb();const records=await db.select().from(t.flights).limit(10000);const labelled=records.filter(f=>f.actualArrival!==null);
      const grouped=new Map<string,number[]>();for(const f of labelled){const key=`${f.originIcao} → ${f.destinationIcao}`;grouped.set(key,[...(grouped.get(key)||[]),(f.actualArrival!-f.scheduledArrival)/60]);}
      return send({routes:[...grouped].map(([route,delays])=>({route,count:delays.length,onTime:delays.filter(d=>d<15).length/delays.length,meanDelay:delays.reduce((a,b)=>a+b,0)/delays.length,severeDelay:delays.filter(d=>d>=180).length/delays.length})),source:"Imported labelled flight records",sampleSize:labelled.length});
    }
    if(p==="watchlists"){const db=await getDb();return send({watchlists:await db.select().from(t.watchlists).orderBy(desc(t.watchlists.createdAt))});}
    if(p==="alerts"){await evaluateWatchlists();const db=await getDb();return send({alerts:await db.select().from(t.alerts).orderBy(desc(t.alerts.eventTimestamp)).limit(100)});}
    if(p==="compensation/history"){const db=await getDb();const records=await db.select().from(t.assessments).orderBy(desc(t.assessments.assessedAt)).limit(30);return send({assessments:records.map(r=>({id:r.id,assessedAt:r.assessedAt,result:JSON.parse(r.resultJson)}))});}
    if(p==="sources/status"){
      let database="connected";try{await getDb();}catch{database="unavailable";}
      return send({database,sources:[{name:"OpenSky Network",status:process.env.OPENSKY_CLIENT_ID?"OAuth2 configured":"Anonymous · limited quota",detail:"120-second regional polling by default; position age shown on map"},{name:"Open-Meteo",status:"Available without key",detail:"Numerical forecast · 15-minute cache · not METAR"},{name:"RainViewer",status:process.env.RADAR_TILE_PROVIDER==="disabled"?"Disabled":"Available without key",detail:"Timestamped past radar frames; personal / educational use"},{name:"Official NOTAM",status:"Not connected",detail:"Requires authorized provider"},{name:"Flight status / schedules",status:"Import only",detail:"Surveillance positions do not provide verified itineraries"},{name:"EUROCONTROL",status:eurocontrolProvider.available?"Available":"Not connected",detail:eurocontrolProvider.message},{name:"LightGBM",status:(await modelStatus()).available?"Model loaded":"Model not trained",detail:"No fabricated predictions"},{name:"Historical delay estimates",status:(await riskStatus()).available?"Sufficient sample":"Insufficient history",detail:"One-year sourced gate-arrival rates; no model artifact"}]});
    }
    return send({error:{code:"NOT_FOUND",message:"Endpoint not found."}},404);
  }catch(e){return fail(e);}
}
const mutations=new Map<string,{count:number;since:number}>();
function validateMutation(request:NextRequest){
  const origin=request.headers.get("origin"),host=request.headers.get("host")||request.nextUrl.host;
  if(origin&&new URL(origin).host!==host)throw new ProviderError("ORIGIN_REJECTED","Cross-origin changes are not permitted.",403);
  const key=request.headers.get("x-forwarded-for")?.split(",")[0]||"local";const previous=mutations.get(key),time=Date.now();
  if(!previous||time-previous.since>60000){mutations.set(key,{count:1,since:time});return;}
  if(previous.count++>=60)throw new ProviderError("RATE_LIMITED","Too many changes; try again in a minute.",429,60);
  if(mutations.size>10000)mutations.clear();
}
export async function POST(request:NextRequest,context:Context){
  try{
    validateMutation(request);if(Number(request.headers.get("content-length")||0)>32768)throw new ProviderError("TOO_LARGE","Request body too large.",413);
    const p=(await context.params).path.join("/");const body=await request.text();if(body.length>32768)throw new ProviderError("TOO_LARGE","Request body too large.",413);let raw:unknown;try{raw=JSON.parse(body);}catch{throw new ProviderError("INVALID_JSON","Send a valid JSON request body.",400);}
    if(p==="compensation/evaluate"){
      const input=assessmentInput.parse(raw),result=evaluateCompensation(input);const db=await getDb();
      const [saved]=await db.insert(t.assessments).values({flightId:input.flightNumber||null,assessedAt:now(),regulationVersion:result.regulationVersion,eligibilityStatus:result.status,potentialAmountEur:result.potentialAmount,knownDisruptionCause:input.reason,missingEvidenceJson:JSON.stringify(result.missingEvidence),explanation:result.explanation,inputJson:JSON.stringify(input),resultJson:JSON.stringify(result)}).returning({id:t.assessments.id});return send({...result,id:saved.id});
    }
    if(p==="watchlists"){
      const input=z.object({targetType:z.enum(["airport","aircraft","route","flight"]),targetId:z.string().min(1).max(80),settings:z.object({gustThresholdMs:z.number().min(0).max(100).optional(),precipitationThresholdMm:z.number().min(0).max(200).optional()}).optional()}).parse(raw);
      if(input.targetType==="airport"&&!findAirport(input.targetId))throw new ProviderError("INVALID_AIRPORT","Airport not found.",400);
      if(input.targetType==="aircraft")identifier.parse(input.targetId);
      const db=await getDb();await db.insert(t.watchlists).values({targetType:input.targetType,targetId:input.targetId,settings:JSON.stringify(input.settings||{}),createdAt:now()}).onConflictDoNothing();return send({saved:true},201);
    }
    if(p==="predict"){
      const input=predictionInput.parse(raw),result=await predict(input.features);const db=await getDb();
      await db.insert(t.predictions).values({...result,flightId:input.flightId,featureSnapshotJson:JSON.stringify(input.features),sourceDataTimestamp:input.sourceDataTimestamp});return send(result);
    }
    if(p==="schedule/predict")return await scheduleApi("v1/predictions","POST",raw)||send(await predictRisk(raw));
    if(p==="schedule/predict/batch")return await scheduleApi("v1/predictions/batch","POST",raw)||send(await predictRiskBatch(raw));
    if(p==="schedule/context")return await scheduleApi("v1/context","POST",raw)||send(await itineraryContext(raw));
    if(p.startsWith("alerts/")){const id=positiveId.parse(p.split("/")[1]);const db=await getDb();await db.update(t.alerts).set({acknowledgedAt:now()}).where(eq(t.alerts.id,id));return send({acknowledged:true});}
    return send({error:{message:"Endpoint not found."}},404);
  }catch(e){return fail(e);}
}
export async function DELETE(request:NextRequest,context:Context){try{validateMutation(request);const path=(await context.params).path;if(path[0]!=="watchlists")return send({error:{message:"Endpoint not found."}},404);const id=positiveId.parse(path[1]),db=await getDb();await db.transaction(async tx=>{await tx.delete(t.alerts).where(eq(t.alerts.watchlistId,id));await tx.delete(t.watchlists).where(eq(t.watchlists.id,id));});return send({deleted:true});}catch(e){return fail(e);}}
