import type { AircraftResponse, WeatherResponse, RadarResponse, SourceMeta, Flight } from "@/lib/types";
export class ProviderError extends Error {
  constructor(public code:string,message:string,public status=503,public retryAfter?:number){super(message);this.name="ProviderError";}
}
export interface AircraftPositionProvider {fetch(region:string,bounds:[number,number,number,number]):Promise<AircraftResponse>}
export interface WeatherForecastProvider {fetch(icao:string):Promise<WeatherResponse>}
export interface RadarTileProvider {fetch():Promise<RadarResponse>}
export interface FlightScheduleProvider {search(query:string):Promise<{flights:Flight[];source:SourceMeta}>}
export interface NotamProvider {fetch(icao:string):Promise<{notices:unknown[];source:SourceMeta}>}
export const unsupportedSource=(provider:string,message:string):SourceMeta=>({provider,status:"unavailable",observedAt:null,retrievedAt:Math.floor(Date.now()/1000),message});
export async function timedFetch(url:string,init:RequestInit={},timeout=12000):Promise<Response> {
  try {return await fetch(url,{...init,signal:AbortSignal.timeout(timeout),cache:"no-store"});}
  catch(e){if(e instanceof Error && ["TimeoutError","AbortError"].includes(e.name))throw new ProviderError("TIMEOUT","The data provider timed out. Try again shortly.",504);throw new ProviderError("NETWORK_ERROR","Unable to reach the data provider.");}
}
