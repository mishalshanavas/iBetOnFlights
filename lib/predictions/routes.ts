import type { FeatureCollection, LineString } from "geojson";
import { findAirport } from "@/data/airports";
import type { DayItem, RiskFlag } from "./day";
import { previewDuration, type Coordinate } from "@/lib/aviation/flight-path";
export const riskColors: Record<RiskFlag, string> = { delay: "#ff9b45", reported_delay: "#ff9b45", cancellation: "#f46b75", reported_cancelled: "#f46b75", lower: "#92a4ba", unavailable: "#657184" };
export const riskLabels: Record<RiskFlag, string> = { delay: "Delay risk", reported_delay: "Reported delay", cancellation: "Cancellation risk", reported_cancelled: "Reported cancelled", lower: "Lower historical risk", unavailable: "Estimate unavailable" };
export function predictionRoutes(items: DayItem[]): FeatureCollection<LineString> {
  return { type: "FeatureCollection", features: items.flatMap(item => {
    const from = findAirport(item.flight.originIcao), to = findAirport(item.flight.destinationIcao);
    if (!from || !to) return [];
    const coordinates: Coordinate[] = [[from.longitude, from.latitude], [to.longitude, to.latitude]];
    return [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates }, properties: { id: item.flight.id, flightNumber: item.flight.flightNumber, color: riskColors[item.flag], label: riskLabels[item.flag], originIcao: from.icao, destinationIcao: to.icao, cancelled: item.flag === "reported_cancelled", animationDurationSeconds: previewDuration(coordinates) } }];
  }) };
}
