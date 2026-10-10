import { and,gte,lt,lte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { publishedPunctuality } from "@/lib/db/schema";
import { publishedDelayRate,publishedStatus,type PublishedRow } from "./caa";
import { canonicalPublishedAirline } from "./caa";

let pending:{expires:number;promise:Promise<PublishedRow[]>}|null=null;
export function clearPublishedHistoryCache(){pending=null;}
export async function publishedHistory(){
  if(pending&&pending.expires>Date.now())return pending.promise;
  const now=new Date(),cutoff=new Date(Date.UTC(now.getUTCFullYear()-1,now.getUTCMonth(),1));
  const period=(date:Date)=>`${date.getUTCFullYear()}${String(date.getUTCMonth()+1).padStart(2,"0")}`;
  const promise=getDb().then(db=>db.select().from(publishedPunctuality).where(and(
    gte(publishedPunctuality.period,period(cutoff)),lt(publishedPunctuality.period,period(now)),
    lte(publishedPunctuality.retrievedAt,Math.floor(Date.now()/1000)))))
    .catch(error=>{pending=null;throw error;});
  pending={expires:Date.now()+300000,promise};return promise;
}
export async function publishedRisk(input:{origin:string;destination:string;operatingAirline:string}){
  return publishedDelayRate(await publishedHistory(),input,Math.floor(Date.now()/1000));
}
export async function publishedHistoryStatus(){return publishedStatus(await publishedHistory());}
export async function publishedRouteBoard(limit=30){
  const rows=await publishedHistory(),asOf=Math.floor(Date.now()/1000);
  const itineraries=new Map<string,{origin:string;destination:string;operatingAirline:string}>();
  for(const row of rows){
    const input={origin:row.direction==="A"?row.otherAirport:row.reportingAirport,
      destination:row.direction==="A"?row.reportingAirport:row.otherAirport,operatingAirline:canonicalPublishedAirline(row.airline)};
    itineraries.set([input.origin,input.destination,input.operatingAirline].join("|"),input);
  }
  return [...itineraries.values()].flatMap(input=>{
    const prediction=publishedDelayRate(rows,input,asOf);return prediction?[{...input,prediction}]:[];
  }).sort((a,b)=>b.prediction.probability180-a.prediction.probability180||b.prediction.cohortSamples-a.prediction.cohortSamples).slice(0,limit);
}
