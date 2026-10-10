import { z } from "zod";
import { findAirport } from "@/data/airports";
import type { WeatherPoint, WeatherResponse } from "@/lib/types";
import { ProviderError, timedFetch, type WeatherForecastProvider } from "./base";
import { cached } from "./cache";
import { now, recordWeather } from "@/lib/db/repository";
const variables="temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,pressure_msl";
export const nullableNumber=(v:unknown):number|null=>typeof v==="number"&&Number.isFinite(v)?v:null;
export function weatherPoint(row:Record<string,unknown>,visibility:unknown=null):WeatherPoint {
  const time=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z?$/).parse(row.time);
  const validAt=time.endsWith("Z")?time:`${time}Z`;
  if(!Number.isFinite(Date.parse(validAt)))throw new ProviderError("INVALID_WEATHER","The weather provider returned an invalid valid-time timestamp.",502);
  return {validAt,temperature:nullableNumber(row.temperature_2m),humidity:nullableNumber(row.relative_humidity_2m),windSpeed:nullableNumber(row.wind_speed_10m),windDirection:nullableNumber(row.wind_direction_10m),windGust:nullableNumber(row.wind_gusts_10m),precipitation:nullableNumber(row.precipitation),cloudCover:nullableNumber(row.cloud_cover),pressure:nullableNumber(row.pressure_msl),visibility:nullableNumber(visibility),code:nullableNumber(row.weather_code)};
}
export const openMeteo:WeatherForecastProvider={async fetch(icao){
  const airport=findAirport(icao);if(!airport)throw new ProviderError("NOT_FOUND","Airport not found.",404);
  const result=await cached<WeatherResponse>(`weather:${airport.icao}`,900,async()=>{
    const url=new URL("https://api.open-meteo.com/v1/forecast");
    for(const [key,value] of Object.entries({latitude:airport.latitude,longitude:airport.longitude,current:variables,hourly:`${variables},visibility`,wind_speed_unit:"ms",timezone:"UTC",forecast_days:3}))url.searchParams.set(key,String(value));
    const response=await timedFetch(url.toString());
    if(!response.ok)throw new ProviderError("WEATHER_UNAVAILABLE",`Open-Meteo returned HTTP ${response.status}.`,502);
    const raw=z.object({current:z.record(z.string(),z.unknown()),hourly:z.record(z.string(),z.array(z.unknown()))}).parse(await response.json());
    const hourly=(raw.hourly.time||[]).map((_,i)=>weatherPoint(Object.fromEntries(Object.entries(raw.hourly).map(([key,values])=>[key,values[i]])),raw.hourly.visibility?.[i]));
    const current=weatherPoint(raw.current);
    const closest=hourly.reduce<WeatherPoint|null>((best,p)=>!best||Math.abs(Date.parse(p.validAt)-Date.parse(current.validAt))<Math.abs(Date.parse(best.validAt)-Date.parse(current.validAt))?p:best,null);
    current.visibility=closest?.visibility??null;
    const data:WeatherResponse={airport:airport.icao,current,hourly,source:{provider:"Open-Meteo · numerical forecast",status:"recent",observedAt:Date.parse(current.validAt)/1000,retrievedAt:now(),message:"Modelled weather; not an official METAR. Visibility is the nearest hourly forecast. Retrieval time is not forecast issuance time."}};
    try{await recordWeather(data);}catch{/* Forecast remains usable without storage. */}
    return data;
  });return {...result.value,source:{...result.value.source,status:result.cached?"cached":"recent"}};
}};
