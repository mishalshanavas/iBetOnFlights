"use client";
import { useQuery } from "@tanstack/react-query";
import { useDashboard } from "@/stores/dashboard";
import type { AircraftResponse, WeatherResponse, RadarResponse, Snapshot, Aircraft, Watchlist, Alert } from "@/lib/types";
import { demoAircraft } from "@/data/demo";
export class ApiError extends Error {constructor(message:string,public retryAfter?:number){super(message);}}
export async function api<T>(url:string,init?:RequestInit):Promise<T>{
  const response=await fetch(url,init);const data=await response.json();
  if(!response.ok)throw new ApiError(data.error?.message||"Request failed.",data.error?.retryAfter);return data;
}
export function useAircraft(){
  const region=useDashboard(s=>s.region),mode=useDashboard(s=>s.mode),snapshotId=useDashboard(s=>s.snapshotId);
  return useQuery<AircraftResponse>({queryKey:["aircraft",region,mode,snapshotId],queryFn:async()=>{
    if(snapshotId!==null){const result=await api<{snapshot:Snapshot;aircraft:Aircraft[]}>(`/api/history/${snapshotId}`);return {aircraft:result.aircraft,region:result.snapshot.region,pollSeconds:120,quotaRemaining:null,source:{provider:"Recorded OpenSky observations",status:"historical",observedAt:result.snapshot.observedAt,retrievedAt:Math.floor(Date.now()/1000)}};}
    if(mode==="demo")return {aircraft:demoAircraft(region),region,pollSeconds:120,quotaRemaining:null,source:{provider:"Local demonstration fixtures",status:"demo",observedAt:1791716400,retrievedAt:Math.floor(Date.now()/1000),message:"Simulated surveillance positions; not real flights. Weather remains provider-sourced."}};
    return api<AircraftResponse>(`/api/aircraft/live?region=${region}`);
  },staleTime:30000,refetchInterval:q=>snapshotId!==null||mode==="demo"?false:q.state.error instanceof ApiError&&q.state.error.retryAfter?q.state.error.retryAfter*1000:(q.state.data?.pollSeconds||120)*1000,retry:false});
}
export function useWeather(icao:string|null){return useQuery<WeatherResponse>({queryKey:["weather",icao],queryFn:()=>api(`/api/airports/${icao}/weather`),enabled:!!icao,staleTime:900000,retry:1});}
export function useRadar(){const enabled=useDashboard(s=>s.layers.radar);return useQuery<RadarResponse>({queryKey:["radar"],queryFn:()=>api("/api/weather/radar"),enabled,staleTime:300000,refetchInterval:300000,retry:1});}
export function useTrack(icao24:string|null){return useQuery<{track:Aircraft[];source:string}>({queryKey:["track",icao24],queryFn:()=>api(`/api/aircraft/${icao24}/track`),enabled:!!icao24&&!icao24.startsWith("d000"),staleTime:60000});}
export function useWatchlists(){return useQuery<{watchlists:Watchlist[]}>({queryKey:["watchlists"],queryFn:()=>api("/api/watchlists"),retry:false});}
export function useAlerts(){return useQuery<{alerts:Alert[]}>({queryKey:["alerts"],queryFn:()=>api("/api/alerts"),refetchInterval:120000,retry:false});}
