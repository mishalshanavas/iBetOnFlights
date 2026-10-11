import { z } from "zod";

export const DAY_POLICY = { delay: 0.2, cancellation: 0.1 } as const;
export const riskSchema = z.object({
  probability30: z.number().min(0).max(1), probability60: z.number().min(0).max(1), probability180: z.number().min(0).max(1),
  cancellationRate: z.number().min(0).max(1).optional(), cohortSamples: z.number().nonnegative(),
  method: z.string(), source: z.string().optional(), direction: z.string().optional(), reportingAirport: z.string().optional(),
  periods: z.array(z.string()).optional(), limitations: z.string().optional(), cohort: z.string().optional(), asOf: z.number().optional(),
}).passthrough();
export type DayRisk = z.infer<typeof riskSchema>;
export type RiskFlag = "delay" | "cancellation" | "lower" | "unavailable" | "reported_cancelled" | "reported_delay";
export function flagRisk(risk: DayRisk | null): RiskFlag {
  if (!risk) return "unavailable";
  if ((risk.cancellationRate ?? 0) >= DAY_POLICY.cancellation) return "cancellation";
  return risk.probability30 >= DAY_POLICY.delay ? "delay" : "lower";
}
export function explainRisk(risk: DayRisk): string[] {
  const published = risk.method === "caa-published-punctuality-v1";
  return [
    `${(risk.probability30 * 100).toFixed(1)}% of comparable operated flights were ${published ? "more than" : "at least"} 30 minutes late (${risk.direction || "arrival"}${risk.reportingAirport ? ` at ${risk.reportingAirport}` : ""}).`,
    `Based on ${risk.cohortSamples.toLocaleString("en-GB")} movements from ${risk.source || "imported gate-arrival history"}${risk.periods?.length ? `, reporting months ${risk.periods.join(", ")}` : ""}${risk.cohort ? `; comparison group: ${risk.cohort.replaceAll("_", " ")}` : ""}.`,
    ...(risk.cancellationRate === undefined ? ["Cancellation risk cannot be estimated from this delay-only history."] : [`${(risk.cancellationRate * 100).toFixed(1)}% of the historical cohort was cancelled; this is not a flight-specific cancellation forecast.`]),
    "The cause of a future disruption is unknown. Weather, crew, aircraft and air traffic restrictions are not established by these historical rates.",
  ];
}
export const dayQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const stamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
  }, "Select a valid calendar day"),
  offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50),
  airport: z.string().regex(/^[A-Z]{4}$/).optional(), source: z.enum(["public", "imported"]).default("public"),
});
export type DayFlight = {
  id: string; flightNumber: string; operatingAirline: string | null; originIcao: string; destinationIcao: string;
  aircraftIcao24: string | null; scheduledDeparture: number; scheduledArrival: number | null; status: string; source: string; updatedAt: number; estimatedDeparture?: number | null;
};
export type DayItem = { flight: DayFlight; prediction: DayRisk | null; flag: RiskFlag; reasons: string[]; error: { code: string; message: string } | null };
export type DayBoard = {
  date: string; timezone: "UTC"; flights: DayItem[]; total: number; offset: number; nextOffset: number | null; asOf: number;
  policy: typeof DAY_POLICY; coverage: string; limitations: string;
  source: { provider: string; configured: boolean; message: string; retrievedAt?: number };
};
