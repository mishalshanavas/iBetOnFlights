"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CloudSun, Plane, ArrowRight } from "lucide-react";
import { PageHeading } from "@/components/layout/page-heading";
import { api } from "@/hooks/use-data";
import { airports, findAirport } from "@/data/airports";
import type { DayRisk } from "@/lib/predictions/day";
import { DayWorkspace } from "./day-workspace";

type Forecast = { status: string; point: { validAt: string; windSpeed: number | null; windGust: number | null; precipitation: number | null; visibility: number | null } | null; source: { provider: string } | null; message: string };
type Context = { prediction: DayRisk | null; predictionError: { message: string } | null; weather: { departure: Forecast; arrival: Forecast } };
type Board = { publishedRoutes?: { origin: string; destination: string; operatingAirline: string }[]; status: { publishedHistory?: { airlines: string[] } } };
const initial = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString().slice(0, 16);
const percent = (number: number) => `${(number * 100).toFixed(number < .01 ? 2 : 1)}%`;

export function ScheduleWorkspace() {
  const [tab, setTab] = useState("delayed");
  return <div className="workspace-page predictions-page"><PageHeading eyebrow="PREDICTIONS / YOUR FLIGHT OUTLOOK" title="Plan ahead. See the risk." description="Explore a day’s flights or check your journey, with the evidence behind every estimate." />
    <div className="prediction-tabs" role="tablist" aria-label="Flight predictions"><button id="delayed-tab" role="tab" aria-selected={tab === "delayed"} aria-controls="delayed-panel" onClick={() => setTab("delayed")}><CalendarDays size={15} />Delayed</button><button id="itinerary-tab" role="tab" aria-selected={tab === "itinerary"} aria-controls="itinerary-panel" onClick={() => setTab("itinerary")}><Plane size={15} />Check a flight</button></div>
    <div id={tab === "delayed" ? "delayed-panel" : "itinerary-panel"} role="tabpanel" aria-labelledby={tab === "delayed" ? "delayed-tab" : "itinerary-tab"}>{tab === "delayed" ? <DayWorkspace /> : <Itinerary />}</div>
  </div>;
}
function Itinerary() {
  const [origin, setOrigin] = useState("EHAM"), [destination, setDestination] = useState("EGLL"), [airline, setAirline] = useState("KLM"), [departure, setDeparture] = useState(() => initial(12)), [arrival, setArrival] = useState(() => initial(14));
  const [assessment, setAssessment] = useState<{ key: string; context: Context | null; error: string } | null>(null), [busy, setBusy] = useState(false);
  const inputKey = JSON.stringify([origin, destination, airline, departure, arrival]), current = assessment?.key === inputKey ? assessment : null, context = current?.context, risk = context?.prediction;
  const board = useQuery<Board>({ queryKey: ["schedule-board"], queryFn: () => api("/api/schedule/flights?limit=50"), retry: false });
  async function run() {
    const key = inputKey; setBusy(true); setAssessment(null);
    try {
      const data = await api<Context>("/api/schedule/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itinerary: { origin, destination, operatingAirline: airline, scheduledDeparture: Date.parse(`${departure}:00Z`) / 1000, scheduledArrival: Date.parse(`${arrival}:00Z`) / 1000 } }) });
      setAssessment({ key, context: data, error: data.predictionError?.message || "" });
    } catch (e) { setAssessment({ key, context: null, error: e instanceof Error ? e.message : "Flight outlook unavailable." }); }
    finally { setBusy(false); }
  }
  return <><div className="itinerary-intro"><h2>A clearer picture of your journey</h2><p>Enter your flight’s airports, airline and scheduled times. We’ll fetch weather automatically.</p></div><div className="page-grid"><section className="workspace-panel itinerary-form"><div className="panel-heading"><h2><Plane size={15} />Your flight</h2><span>ALL TIMES IN UTC</span></div><form className="panel-body" onSubmit={event => { event.preventDefault(); void run(); }}><div className="form-grid">
    <label className="form-field"><span>From</span><select aria-label="From" value={origin} onChange={e => setOrigin(e.target.value)}>{airports.map(a => <option key={a.icao} value={a.icao}>{a.iata} · {a.city}</option>)}</select></label><label className="form-field"><span>To</span><select aria-label="To" value={destination} onChange={e => setDestination(e.target.value)}>{airports.map(a => <option key={a.icao} value={a.icao}>{a.iata} · {a.city}</option>)}</select></label>
    <label className="form-field full"><span>Operating airline</span><input required value={airline} onChange={e => setAirline(e.target.value)} placeholder="For example, KLM or British Airways" maxLength={100} list="published-airlines" /><datalist id="published-airlines">{board.data?.status.publishedHistory?.airlines.map(name => <option key={name} value={name} />)}</datalist></label>
    <label className="form-field"><span>Scheduled departure · UTC</span><input required type="datetime-local" value={departure} onChange={e => setDeparture(e.target.value)} /></label><label className="form-field"><span>Scheduled arrival · UTC</span><input required type="datetime-local" value={arrival} onChange={e => setArrival(e.target.value)} /></label>
    </div><div className="form-submit-row"><span>Check at least one hour before departure</span><button className="ui-button button-accent" type="submit" disabled={busy}>{busy ? "Checking your flight…" : "Get flight outlook"}<ArrowRight size={13} /></button></div></form></section>
    <section className="itinerary-result" aria-live="polite"><div className="itinerary-route"><strong>{findAirport(origin)?.iata}</strong><Plane size={22} /><strong>{findAirport(destination)?.iata}</strong><span>{airline || "Your airline"}</span></div>{risk ? <><p className="outlook-note">Historical {risk.direction || "arrival"} rates{risk.reportingAirport ? ` at ${risk.reportingAirport}` : ""}</p><div className="itinerary-risk-grid">{[["30 min delay", risk.probability30], ["60 min delay", risk.probability60], ["3 hour delay", risk.probability180]].map(([label, value]) => <div key={String(label)}><span>{risk.method === "caa-published-punctuality-v1" ? "More than " : "At least "}{label}</span><strong>{percent(Number(value))}</strong></div>)}</div><p className="outlook-note">Based on {risk.cohortSamples.toLocaleString()} comparable movements. Historical rates are not a guarantee for your flight.</p><details className="outlook-evidence"><summary>How this estimate was calculated</summary><p>Source: {risk.source || "Imported gate-arrival history"}. Comparison: {risk.cohort?.replaceAll("_", " ") || "Historical cohort"}.</p>{risk.periods?.length && <p>Reporting months: {risk.periods.join(", ")}.</p>}<p>{risk.limitations}</p><p>Future disruption causes are unknown. Weather is shown separately and does not alter these percentages.</p></details></> : <div className="itinerary-result-empty"><Plane size={26} /><h2>{busy ? "Checking the evidence…" : "Your outlook appears here"}</h2><p role={current?.error ? "alert" : undefined}>{current?.error || "We’ll show available delay history and weather for your scheduled flight."}</p></div>}{current?.error && risk && <p role="alert">{current.error}</p>}</section>
    </div>{context && <div className="page-grid equal page-grid-margin"><Weather title={`Departure weather · ${findAirport(origin)?.iata}`} forecast={context.weather.departure} /><Weather title={`Arrival weather · ${findAirport(destination)?.iata}`} forecast={context.weather.arrival} /></div>}
    {!!board.data?.publishedRoutes?.length && <details className="outlook-evidence supported-routes"><summary>Browse routes with available history</summary><div className="supported-route-list">{board.data.publishedRoutes.map(row => <button className="ui-button button-outline" key={`${row.origin}-${row.destination}-${row.operatingAirline}`} onClick={() => { setOrigin(row.origin); setDestination(row.destination); setAirline(row.operatingAirline); setAssessment(null); }}>{findAirport(row.origin)?.iata || row.origin} → {findAirport(row.destination)?.iata || row.destination}<small>{row.operatingAirline}</small></button>)}</div></details>}
    <p className="outlook-note">Weather comes from Open-Meteo, matched to your scheduled times when a forecast is available within 48 hours. Airport notices and a specific disruption cause are unavailable.</p>
  </>;
}
function Weather({ title, forecast }: { title: string; forecast: Forecast }) {
  const point = forecast.point;
  return <section className="workspace-panel itinerary-weather"><div className="panel-heading"><h2><CloudSun size={16} />{title}</h2><span>{point ? "FORECAST AVAILABLE" : "FORECAST UNAVAILABLE"}</span></div><div className="panel-body">{point ? <><div className="weather-outlook-grid"><div><span>Wind / gust</span><strong>{point.windSpeed ?? "—"} / {point.windGust ?? "—"}<small>m/s</small></strong></div><div><span>Rain forecast</span><strong>{point.precipitation ?? "—"}<small>mm</small></strong></div><div><span>Visibility</span><strong>{point.visibility === null ? "—" : (point.visibility / 1000).toFixed(1)}<small>km</small></strong></div></div><p className="outlook-note">Forecast for {new Date(point.validAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC · {forecast.source?.provider || "Open-Meteo"}. Forecast conditions do not establish a disruption cause.</p></> : <p className="outlook-note">{forecast.message}</p>}</div></section>;
}
