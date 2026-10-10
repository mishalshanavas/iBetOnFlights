import { z } from "zod";
import { findAirport } from "@/data/airports";
import { ProviderError } from "@/lib/providers/base";

export const scheduleNumericFeatures = ["departure_hour_sin", "departure_hour_cos", "weekday_sin", "weekday_cos", "month_sin", "month_cos", "duration_hours"] as const;
const airline = z.string().trim().min(1).max(100).transform(v => v.toUpperCase());
export const scheduleInput = z.object({
  origin: z.string().regex(/^[A-Za-z]{4}$/).transform(v => v.toUpperCase()),
  destination: z.string().regex(/^[A-Za-z]{4}$/).transform(v => v.toUpperCase()),
  operatingAirline: airline,
  scheduledDeparture: z.number().int().positive(),
  scheduledArrival: z.number().int().positive(),
}).strict().refine(v => v.origin !== v.destination, "Origin and destination must differ")
  .refine(v => v.scheduledArrival > v.scheduledDeparture && v.scheduledArrival - v.scheduledDeparture <= 86400,
    "Scheduled arrival must follow departure within 24 hours");
export type ScheduleInput = z.infer<typeof scheduleInput>;

const finite = z.number().finite();
const weights = z.record(z.string(), finite);
export const scheduleModelSchema = z.object({
  kind: z.literal("schedule-logistic"), contract: z.literal("europe-schedule-logistic-v1"),
  version: z.string().min(1), features: z.array(z.string()).refine(v=>JSON.stringify(v)===JSON.stringify([...scheduleNumericFeatures,"origin","destination","operatingAirline"]),"Invalid feature order"),
  numericFeatures: z.array(z.string()).refine(v => JSON.stringify(v) === JSON.stringify(scheduleNumericFeatures)),
  means: z.array(finite).length(7), scales: z.array(finite.positive()).length(7),
  coverage: z.object({origin: z.array(z.string()).min(1), destination: z.array(z.string()).min(1), operatingAirline: z.array(z.string()).min(1)}),
  routeSupport: z.record(z.string(), z.number().int().nonnegative()),
  predictionLeadSeconds: z.literal(3600), evaluatedOnEuropeanRecords: z.literal(true),
  trainedAt: z.string().datetime({offset: true}), testPeriod: z.array(z.string()).length(2), metrics: z.record(z.string(), z.unknown()),
  release: z.object({passed: z.boolean(), reasons: z.array(z.string()), minimumRouteSamples: z.number().int().min(30), minimumClassCount: z.number().int().min(20)}),
  models: z.array(z.object({threshold: z.number(), intercept: finite, numericWeights: z.array(finite).length(7),
    categoricalWeights: z.object({origin: weights, destination: weights, operatingAirline: weights}),
    calibration: z.object({a: finite, b: finite})})).length(3)
    .refine(v => v.every((m, i) => m.threshold === [30, 60, 180][i]), "Invalid threshold order"),
}).superRefine((model, ctx) => {
  for (const name of ["origin", "destination", "operatingAirline"] as const) {
    for (const category of model.coverage[name]) {
      if (model.models.some(m => m.categoricalWeights[name][category] === undefined))
        ctx.addIssue({code: "custom", message: `Missing ${name} coefficient: ${category}`});
    }
  }
});
export type ScheduleModel = z.infer<typeof scheduleModelSchema>;

export function scheduleVector(input: ScheduleInput): number[] {
  const dt = new Date(input.scheduledDeparture * 1000);
  const hour = dt.getUTCHours() + dt.getUTCMinutes() / 60 + dt.getUTCSeconds() / 3600;
  const phases = [hour / 24, ((dt.getUTCDay() + 6) % 7) / 7, dt.getUTCMonth() / 12];
  return [...phases.flatMap(p => [Math.sin(2 * Math.PI * p), Math.cos(2 * Math.PI * p)]),
    (input.scheduledArrival - input.scheduledDeparture) / 3600];
}

/** Pure evaluator also used by the exported Python/TypeScript parity check. */
export function scoreSchedule(model: ScheduleModel, input: ScheduleInput): number[] {
  const vector = scheduleVector(input).map((v, i) => (v - model.means[i]) / model.scales[i]);
  const values = model.models.map(m => {
    let raw = m.intercept + m.numericWeights.reduce((sum, w, i) => sum + w * vector[i], 0);
    for (const name of ["origin", "destination", "operatingAirline"] as const) raw += m.categoricalWeights[name][input[name]] ?? 0;
    const logit = Math.max(-700, Math.min(700, m.calibration.a * raw + m.calibration.b));
    return 1 / (1 + Math.exp(-logit));
  });
  return values.map((v, i) => Math.min(v, ...values.slice(0, i)));
}

export function assertScheduleSupported(model: ScheduleModel, input: ScheduleInput) {
  if (!model.release.passed) throw new ProviderError("MODEL_NOT_RELEASED", "The model did not pass held-out evaluation. Predictions are unavailable.", 503);
  for (const name of ["origin", "destination", "operatingAirline"] as const) {
    if (!model.coverage[name].includes(input[name])) throw new ProviderError("UNSUPPORTED_ITINERARY", "This airport or operating airline was not represented in model training.", 422);
  }
  if (!findAirport(input.origin) || !findAirport(input.destination)) throw new ProviderError("INVALID_AIRPORT", "Select supported airports.", 422);
  const sample = model.routeSupport[`${input.origin}|${input.destination}|${input.operatingAirline}`] ?? 0;
  if (sample < model.release.minimumRouteSamples) throw new ProviderError("INSUFFICIENT_ROUTE_HISTORY", `This airline and route need at least ${model.release.minimumRouteSamples} training flights. Found ${sample}.`, 422);
  return sample;
}
