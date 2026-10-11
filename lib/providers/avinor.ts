import { airports } from "@/data/airports";
import { cached } from "./cache";
import { ProviderError, timedFetch } from "./base";
import type { DayFlight } from "@/lib/predictions/day";
import { canonicalPublishedAirline } from "@/lib/predictions/caa";

const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|apos);/g, value => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[value]!);
const field = (xml: string, name: string) => decode(xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? "").trim();
export function parseAvinorDepartures(xml: string, date: string, observedAt: number) {
  // This public feed contains flat flight elements. Reject DTD/entity documents, never expand XML entities.
  if (!xml.includes("<flights") || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ProviderError("INVALID_SCHEDULE_RESPONSE", "The public airport feed returned an unexpected document.", 502);
  const start = Date.parse(`${date}T00:00:00Z`) / 1000, seen = new Set<string>();
  const records: { flight: DayFlight; evidence: { scheduleObservedAt: number } }[] = [];
  for (const match of xml.matchAll(/<flight\s+[^>]*uniqueID="([^"]+)"[^>]*>([\s\S]*?)<\/flight>/g)) {
    const body = match[2], departure = Date.parse(field(body, "schedule_time")) / 1000;
    if (field(body, "arr_dep") !== "D" || !Number.isFinite(departure) || departure < start || departure >= start + 86400) continue;
    const id = `avinor:${match[1]}`; if (seen.has(id)) continue; seen.add(id);
    const destinationIata = field(body, "airport"), destination = airports.find(a => a.iata === destinationIata);
    const statusTag = body.match(/<status\b([^>]*)\/?\s*>/)?.[1] || "";
    const code = statusTag.match(/code="([^"]*)"/)?.[1], estimated = Date.parse(statusTag.match(/time="([^"]*)"/)?.[1] || "") / 1000;
    const estimatedDeparture = code === "E" && Number.isFinite(estimated) ? estimated : null;
    const status = code === "C" ? "cancelled" : code === "D" ? "departed" : estimatedDeparture !== null && estimatedDeparture - departure >= 1800 ? "reported_delay" : "scheduled";
    records.push({ flight: { id, flightNumber: field(body, "flight_id"), operatingAirline: canonicalPublishedAirline(field(body, "airline")) || null,
      originIcao: "ENGM", destinationIcao: destination?.icao || destinationIata, scheduledDeparture: departure, scheduledArrival: null,
      aircraftIcao24: null, status, estimatedDeparture, source: "Avinor public airport feed", updatedAt: observedAt }, evidence: { scheduleObservedAt: observedAt } });
  }
  return records.sort((a, b) => a.flight.scheduledDeparture - b.flight.scheduledDeparture || a.flight.id.localeCompare(b.flight.id));
}
export async function fetchAvinorDay(date: string) {
  const start = Date.parse(`${date}T00:00:00Z`), now = Date.now(), hoursAhead = Math.ceil((start + 86400000 - now) / 3600000);
  if (start < now - 36 * 3600000 || hoursAhead > 336) throw new ProviderError("DATE_OUT_OF_RANGE", "The free airport feed covers recent flights and up to 14 days ahead. Later schedules can be imported.", 422);
  // Cache the airport feed, not each requested date: changing dates cannot bypass the three-minute cadence.
  const feed = await cached("avinor:OSL:departures:v1", 180, async () => {
    const response = await timedFetch("https://asrv.avinor.no/XmlFeed/v1.0?airport=OSL&TimeFrom=36&TimeTo=336&direction=D");
    if (!response.ok) throw new ProviderError("SCHEDULE_PROVIDER_ERROR", `The public airport feed returned HTTP ${response.status}.`, 502);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 8 * 1024 * 1024) throw new ProviderError("INVALID_SCHEDULE_RESPONSE", "The airport feed exceeded its supported size.", 502);
    const xml = new TextDecoder("iso-8859-1").decode(bytes);
    if (!xml.includes("<flights")) throw new ProviderError("INVALID_SCHEDULE_RESPONSE", "The airport feed is unavailable.", 502);
    return { xml, retrievedAt: Math.floor(Date.now() / 1000) };
  });
  return { records: parseAvinorDepartures(feed.value.xml, date, feed.value.retrievedAt), retrievedAt: feed.value.retrievedAt };
}
