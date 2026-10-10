import { z } from "zod";
import { openMeteo } from "@/lib/providers/weather";
import { ProviderError } from "@/lib/providers/base";
import { itineraryInput } from "./itinerary";
import { predictRisk } from "./schedule-service";

export const contextInput=z.object({
  itinerary:itineraryInput,
  thresholds:z.object({gustMs:z.number().min(0).max(100).default(18),precipitationMm:z.number().min(0).max(200).default(3)}).default({gustMs:18,precipitationMm:3})
}).strict();

async function forecastAt(airport:string,at:number,thresholds:{gustMs:number;precipitationMm:number}){
  if(at>Date.now()/1000+48*3600)return {status:"outside_forecast_window" as const,airport,point:null,source:null,alerts:[],message:"The assessment supports forecasts up to 48 hours ahead."};
  try{
    const weather=await openMeteo.fetch(airport);
    const nearest=weather.hourly.reduce<(typeof weather.hourly)[number]|null>((best,point)=>
      !best||Math.abs(Date.parse(point.validAt)/1000-at)<Math.abs(Date.parse(best.validAt)/1000-at)?point:best,null);
    if(!nearest||Math.abs(Date.parse(nearest.validAt)/1000-at)>3600)return {status:"outside_forecast_window" as const,airport,point:null,source:weather.source,alerts:[],message:"No hourly forecast matches the flight time."};
    const alerts:string[]=[];
    if(nearest.windGust!==null&&nearest.windGust>=thresholds.gustMs)alerts.push("gust_threshold");
    if(nearest.precipitation!==null&&nearest.precipitation>=thresholds.precipitationMm)alerts.push("precipitation_threshold");
    return {status:"available" as const,airport,point:nearest,source:weather.source,alerts,message:"Numerical forecast near the scheduled time; alerts indicate user-selected weather thresholds, not confirmed disruption."};
  }catch(e){return {status:"unavailable" as const,airport,point:null,source:null,alerts:[],message:e instanceof Error?e.message:"Weather provider unavailable."};}
}

export async function itineraryContext(raw:unknown){
  const {itinerary,thresholds}=contextInput.parse(raw);
  if(itinerary.scheduledDeparture<Math.floor(Date.now()/1000)+3600)throw new ProviderError("TOO_LATE","This assessment requires at least one hour before departure.",422);
  const [risk,departureWeather,arrivalWeather]=await Promise.all([
    predictRisk(itinerary).then(prediction=>({prediction,error:null}),e=>({prediction:null,error:e instanceof ProviderError?{code:e.code,message:e.message}:{code:"RISK_UNAVAILABLE",message:"Historical risk unavailable."}})),
    forecastAt(itinerary.origin,itinerary.scheduledDeparture,thresholds),
    forecastAt(itinerary.destination,itinerary.scheduledArrival,thresholds)
  ]);
  return {itinerary,prediction:risk.prediction,predictionError:risk.error,
    weather:{departure:departureWeather,arrival:arrivalWeather,thresholds},
    operationalNotices:{status:"unavailable",message:"An authorized NOTAM feed is not connected. NOTAMs do not provide flight-delay outcomes."},
    limitations:"Weather alerts do not change the historical delay percentage until time-matched forecast and outcome data are validated."};
}
