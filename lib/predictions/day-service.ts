import { and, asc, count, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { flights, flightPredictionEvidence } from "@/lib/db/schema";
import { itineraryInput } from "./itinerary";
import { predictRiskBatch, riskForRoute } from "./schedule-service";
import { DAY_POLICY, dayQuery, explainRisk, flagRisk, riskSchema, type DayBoard, type DayItem } from "./day";
import { fetchAvinorDay } from "@/lib/providers/avinor";
import { findAirport } from "@/data/airports";
import { ProviderError } from "@/lib/providers/base";

type Itinerary = z.infer<typeof itineraryInput>;
type Predictor = (flights: Itinerary[]) => Promise<unknown>;
const batchResult = z.object({ predictions: z.array(z.object({ index: z.number().int().nonnegative(), prediction: riskSchema.nullable(), error: z.object({ code: z.string(), message: z.string() }).nullable() })) });

/** All imported schedules for the UTC day are accessible in stable, bounded pages. */
export async function dayFlightPredictions(raw: unknown, predict: Predictor = inputs => predictRiskBatch({ flights: inputs })): Promise<DayBoard> {
  const { date, offset, limit, airport, source } = dayQuery.parse(raw), start = Date.parse(`${date}T00:00:00Z`) / 1000;
  const asOf = Math.floor(Date.now() / 1000), db = await getDb();
  if(source==="public"&&airport&&airport!=="ENGM")throw new ProviderError("UNSUPPORTED_AIRPORT","The free feed currently covers Oslo departures. Select imported schedules for other airports.",422);
  const live = source === "public" ? await fetchAvinorDay(date) : null;
  const range = and(gte(flights.scheduledDeparture, start), lt(flights.scheduledDeparture, start + 86400), airport ? eq(flights.originIcao, airport) : undefined);
  const [records, counts] = live ? [live.records.slice(offset,offset+limit), [{ total: live.records.length }]] : await Promise.all([
    db.select({ flight: flights, evidence: flightPredictionEvidence }).from(flights)
      .leftJoin(flightPredictionEvidence, eq(flights.id, flightPredictionEvidence.flightId))
      .where(range).orderBy(asc(flights.scheduledDeparture), asc(flights.id)).limit(limit).offset(offset),
    db.select({ total: count() }).from(flights).where(range),
  ]);
  const inputs: Itinerary[] = [], indices: number[] = [], routes: {index:number;origin:string;destination:string;operatingAirline:string;scheduledDeparture:number}[]=[];
  const items: DayItem[] = records.map(({ flight, evidence }, index) => {
    const reportedDelay=flight.status==="reported_delay"&&flight.updatedAt<=asOf;
    const item: DayItem = { flight, prediction: null, flag: reportedDelay?"reported_delay":"unavailable", reasons: [], error: null };
    if(reportedDelay)item.reasons.push(`Avinor reports an estimated departure ${Math.round((item.flight.estimatedDeparture!-flight.scheduledDeparture)/60)} minutes after schedule. This is a provider estimate, not a historical prediction.`);
    const unavailable = (code: string, message: string) => { item.error = { code, message }; item.reasons.push(message); return item; };
    if (/^(cancelled|canceled|c)$/i.test(flight.status) && flight.updatedAt <= asOf) {
      return { ...item, flag: "reported_cancelled", reasons: [`Reported cancelled by ${flight.source}; this is an observed status, not a prediction.`] };
    }
    if (flight.scheduledDeparture < asOf + 3600 || /^(departed|arrived|landed)$/i.test(flight.status)) return unavailable("TOO_LATE", "Less than one hour remains before departure, or this flight has already departed. A new advance estimate is unavailable.");
    if (!evidence || evidence.scheduleObservedAt > Math.min(asOf, flight.scheduledDeparture - 3600)) return unavailable("UNVERIFIED_SCHEDULE", "A timestamped schedule observed at least one hour before departure is required.");
    if(live){
      if(!findAirport(flight.originIcao)||!findAirport(flight.destinationIcao)||!flight.operatingAirline)return unavailable("UNSUPPORTED_ROUTE","This route or airline is outside the available historical coverage.");
      routes.push({index,origin:flight.originIcao,destination:flight.destinationIcao,operatingAirline:flight.operatingAirline,scheduledDeparture:flight.scheduledDeparture});return item;
    }
    const parsed = itineraryInput.safeParse({ origin: flight.originIcao, destination: flight.destinationIcao, operatingAirline: flight.operatingAirline, scheduledDeparture: flight.scheduledDeparture, scheduledArrival: flight.scheduledArrival });
    if (!parsed.success) return unavailable("INVALID_SCHEDULE", "A supported origin, destination, operating airline and complete flight times are required.");
    indices.push(index); inputs.push(parsed.data); return item;
  });
  if (inputs.length) {
    const result = batchResult.parse(await predict(inputs));
    const byIndex = new Map(result.predictions.map(row => [row.index, row]));
    for (const [inputIndex, itemIndex] of indices.entries()) {
      const row = byIndex.get(inputIndex), item = items[itemIndex];
      item.prediction = row?.prediction ?? null;
      if(item.flag!=="reported_delay")item.flag = flagRisk(item.prediction);
      item.error = row?.error ?? (item.prediction ? null : { code: "PREDICTION_UNAVAILABLE", message: "No supported historical estimate is available for this flight." });
      item.reasons.push(...(item.prediction ? explainRisk(item.prediction) : [item.error!.message]));
    }
  }
  await Promise.all(routes.map(async({index,...route})=>{
    const item=items[index];try{item.prediction=riskSchema.parse(await riskForRoute(route));if(item.flag!=="reported_delay")item.flag=flagRisk(item.prediction);item.reasons.push(...explainRisk(item.prediction));}
    catch(e){item.error=e instanceof ProviderError?{code:e.code,message:e.message}:{code:"PREDICTION_UNAVAILABLE",message:"Historical estimate unavailable."};item.reasons.push(item.error.message);}
  }));
  const total = counts[0]?.total ?? 0;
  return { date, timezone: "UTC", flights: items, total, offset, nextOffset: offset + records.length < total ? offset + limit : null, asOf,
    source: live ? { provider: "Avinor", configured: true, message: "Free live Oslo departure board, refreshed every three minutes. Published arrival times are not provided and are not invented.", retrievedAt: live.retrievedAt } : { provider: "Imported schedules", configured: true, message: "Only sourced schedules imported into your database are shown." },
    policy: DAY_POLICY, coverage: live ? "Public Oslo departures, up to 14 days ahead; completeness depends on the airport feed. Unsupported routes still appear with an explanation. Times and selected day are UTC." : "Imported flight schedules only. Surveillance positions and monthly CAA totals are not daily flight schedules.",
    limitations: "Orange marks historical delay rates of 20% or more; red marks historical cancellation rates of 10% or more, or reported cancellations. These watchlist cutoffs are not validated individual-flight predictions." };
}
