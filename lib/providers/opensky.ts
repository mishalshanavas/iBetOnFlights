import { z } from "zod";
import type { Aircraft, AircraftResponse } from "@/lib/types";
import { ProviderError, timedFetch, type AircraftPositionProvider } from "./base";
import { cached } from "./cache";
import { now, recordAircraft,readCache,writeCache } from "@/lib/db/repository";
export const boundsSchema=z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90),z.number().min(-180).max(180),z.number().min(-90).max(90)]).refine(([w,s,e,n])=>e>w&&n>s&&(e-w)*(n-s)<=250,"Select a smaller, valid coverage area (maximum 250 square degrees).");
const finite=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null;
export function normalizeState(row:unknown):Aircraft|null {
  if(!Array.isArray(row)||row.length<17||typeof row[0]!=="string"||!/^[a-f0-9]{6}$/i.test(row[0]))return null;
  const longitude=finite(row[5]),latitude=finite(row[6]),lastContact=finite(row[4]);
  if(longitude===null||latitude===null||Math.abs(latitude)>90||Math.abs(longitude)>180||lastContact===null||lastContact<0)return null;
  const heading=finite(row[10]);
  return {icao24:row[0].toLowerCase(),callsign:typeof row[1]==="string"?row[1].trim()||null:null,originCountry:typeof row[2]==="string"?row[2]:null,timePosition:finite(row[3]),lastContact,longitude,latitude,baroAltitude:finite(row[7]),onGround:row[8]===true,velocity:finite(row[9])!==null&&row[9]>=0?row[9]:null,heading:heading!==null&&heading>=0&&heading<=360?heading%360:null,verticalRate:finite(row[11]),geoAltitude:finite(row[13]),squawk:typeof row[14]==="string"?row[14]:null,spi:row[15]===true,positionSource:finite(row[16])};
}
let token:{value:string;expires:number}|null=null;
let tokenRequest:Promise<string|null>|null=null;
export async function accessToken():Promise<string|null> {
  if(!process.env.OPENSKY_CLIENT_ID||!process.env.OPENSKY_CLIENT_SECRET)return null;
  if(token && token.expires>Date.now()+30000)return token.value;
  if(tokenRequest)return tokenRequest;
  tokenRequest=(async()=>{
    const response=await timedFetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:process.env.OPENSKY_CLIENT_ID!,client_secret:process.env.OPENSKY_CLIENT_SECRET!})});
    if(!response.ok)throw new ProviderError("AUTH_FAILED","OpenSky authentication failed. Check the server-side API client credentials.",502);
    const parsed=z.object({access_token:z.string(),expires_in:z.number().positive().default(1800)}).parse(await response.json());
    token={value:parsed.access_token,expires:Date.now()+parsed.expires_in*1000};return token.value;
  })();try{return await tokenRequest;}finally{tokenRequest=null;}
}
export function clearToken(){token=null;}
export const opensky:AircraftPositionProvider={async fetch(region,bounds){
  boundsSchema.parse(bounds);
  const pollSeconds=Math.min(600,Math.max(60,Number(process.env.AIRCRAFT_POLL_SECONDS)||120));
  const key=`opensky:${bounds.join(":")}`;
  let cooldown:{until:number}|null=null;
  try{cooldown=await readCache<{until:number}>("opensky:quota-cooldown");}catch{/* Keep source reads independent of storage availability. */}
  if(cooldown&&cooldown.until>now())throw new ProviderError("RATE_LIMITED","OpenSky quota is exhausted. Tracking will resume after the provider's retry interval.",429,cooldown.until-now());
  const result=await cached<AircraftResponse>(key,pollSeconds,async()=>{
    const [w,s,e,n]=bounds;const url=new URL("https://opensky-network.org/api/states/all");
    for(const [key,value] of Object.entries({lamin:s,lomin:w,lamax:n,lomax:e}))url.searchParams.set(key,String(value));
    let response:Response|undefined;
    for(let attempt=0;attempt<3;attempt++){
      const bearer=await accessToken();response=await timedFetch(url.toString(),{headers:bearer?{Authorization:`Bearer ${bearer}`}:{}});
      if(response.status===401 && attempt===0 && bearer){clearToken();continue;}
      if(response.status===429){const retry=Math.max(60,Math.min(86400,Number(response.headers.get("X-Rate-Limit-Retry-After-Seconds")||response.headers.get("Retry-After"))||600));try{await writeCache("opensky:quota-cooldown",{until:now()+retry},retry);}catch{/* The error still exposes the retry interval to clients. */}throw new ProviderError("RATE_LIMITED","OpenSky quota is exhausted. Tracking will resume after the provider's retry interval.",429,retry);}
      if(response.ok)break;
      if(response.status<500||attempt===2)throw new ProviderError("UPSTREAM_ERROR",`OpenSky returned HTTP ${response.status}.`,502);
      await new Promise(resolve=>setTimeout(resolve,250*2**attempt));
    }
    const raw=z.object({time:z.number(),states:z.array(z.unknown()).nullable()}).parse(await response!.json());
    const aircraft=(raw.states||[]).map(normalizeState).filter((a):a is Aircraft=>a!==null && now()-(a.timePosition??a.lastContact)<=300);
    const data:AircraftResponse={aircraft,region,pollSeconds,quotaRemaining:response!.headers.has("X-Rate-Limit-Remaining")?Number(response!.headers.get("X-Rate-Limit-Remaining")):null,source:{provider:"OpenSky Network",status:"recent",observedAt:raw.time,retrievedAt:now()}};
    try{data.snapshotId=await recordAircraft(data);}catch{data.storageWarning="Positions displayed, but recording is unavailable. Check the database connection.";}
    return data;
  });
  return {...result.value,region,source:{...result.value.source,status:result.cached?"cached":"recent"}};
}};
