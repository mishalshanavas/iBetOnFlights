import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { canonicalPublishedAirline } from "./caa";
import { monotoneProbabilities, sigmoid, treeValue } from "./inference";

const categorical = ["origin", "destination", "airline", "direction", "route"] as const;
const finite = z.number().finite();
const count = z.number().int().nonnegative();
const period = z.string().regex(/^20\d{2}(0[1-9]|1[0-2])$/);
const totalsSchema = z.object({ matched: count.positive(), late30: count, late60: count, late180: count, periods: z.array(period).min(1) })
  .refine(v => v.late180 <= v.late60 && v.late60 <= v.late30 && v.late30 <= v.matched);
type Tree = { leaf_value: number } | { split_feature: number; threshold: number; decision_type: "<="; default_left: boolean; left_child: Tree; right_child: Tree };
const treeSchema: z.ZodType<Tree> = z.lazy(() => z.union([
  z.object({ leaf_value: finite }).strict(),
  z.object({ split_feature: count, threshold: finite, decision_type: z.literal("<="), default_left: z.boolean(), left_child: treeSchema, right_child: treeSchema }).strict(),
]));
export const caaModelSchema = z.object({
  contract: z.literal("caa-europe-cohort-v1"), kind: z.literal("calibrated-binomial-lightgbm"),
  version: z.string().min(1), trainedAt: z.string().datetime({ offset: true }),
  features: z.array(z.string()).min(3).max(2000),
  vocabulary: z.object({ origin: z.array(z.string()).min(1), destination: z.array(z.string()).min(1), airline: z.array(z.string()).min(1), direction: z.array(z.enum(["A", "D"])).min(1), route: z.array(z.string()).min(1) }),
  baseline: z.record(z.string(), totalsSchema),
  dataThrough: period, periods: z.object({ train: z.array(period).min(1), selection: z.array(period).min(1), calibration: z.array(period).min(1), test: z.array(period).min(1) }),
  minimumRouteSamples: count.min(100), minimumRouteMonths: count.min(3), maximumModelAgeDays: count.positive().max(180), maximumHorizonDays: count.positive().max(180),
  dataset: z.object({ provider: z.literal("UK Civil Aviation Authority"), sha256: z.string().regex(/^[a-f0-9]{64}$/), aggregateRecords: count.positive(), matchedMovements: count.positive(), individualFlightRecords: z.literal(0), periods: z.array(period).min(1), sourceUrls: z.array(z.url()).optional() }),
  evaluationScope: z.string().min(1), metrics: z.record(z.string(), z.unknown()), partitionSamples: z.record(z.string(), z.unknown()),
  release: z.object({ passed: z.boolean(), reasons: z.array(z.string()) }),
  models: z.array(z.object({ threshold: z.number(), trees: z.array(treeSchema).min(1).max(1000), blend: finite.min(0).max(1), calibration: z.object({ a: finite.positive(), b: finite }) })).length(3),
}).superRefine((model, ctx) => {
  const expected = ["month_sin", "month_cos", ...categorical.flatMap(name => model.vocabulary[name].map(value => `${name}=${value}`))];
  if (JSON.stringify(expected) !== JSON.stringify(model.features)) ctx.addIssue({ code: "custom", message: "Incompatible feature ordering" });
  if (!model.baseline.global) ctx.addIssue({ code: "custom", message: "Missing global baseline" });
  const visit = (tree: Tree): boolean => "leaf_value" in tree || (tree.split_feature < expected.length && visit(tree.left_child) && visit(tree.right_child));
  if (model.models.some((m, i) => m.threshold !== [30, 60, 180][i] || !m.trees.every(visit))) ctx.addIssue({ code: "custom", message: "Invalid threshold or tree feature index" });
  if (model.release.passed && model.release.reasons.length) ctx.addIssue({ code: "custom", message: "Inconsistent release gate" });
  const partitions = [model.periods.train, model.periods.selection, model.periods.calibration, model.periods.test];
  if (partitions.some(p => JSON.stringify(p) !== JSON.stringify([...new Set(p)].sort())) ||
      partitions.some((p, i) => i > 0 && p[0] <= partitions[i - 1].at(-1)!) || model.dataThrough !== model.periods.calibration.at(-1))
    ctx.addIssue({ code: "custom", message: "Incompatible chronological partitions" });
});
export type CaaModel = z.infer<typeof caaModelSchema>;
export type CaaFeatures = { origin: string; destination: string; airline: string; direction: string; period: string };
export const caaRouteKey = (row: Omit<CaaFeatures, "period">) => [row.origin, row.destination, row.airline, row.direction].join("|");
const logit = (value: number) => { const p = Math.max(1e-9, Math.min(1 - 1e-9, value)); return Math.log(p / (1 - p)); };

export function caaVector(model: CaaModel, row: CaaFeatures) {
  const phase = 2 * Math.PI * (Number(row.period.slice(4)) - 1) / 12;
  const values = { ...row, route: caaRouteKey(row) };
  return [Math.sin(phase), Math.cos(phase), ...categorical.flatMap(name => model.vocabulary[name].map(value => Number(values[name] === value)))];
}
function seasonalBaseline(model: CaaModel, row: CaaFeatures, field: "late30" | "late60" | "late180") {
  const global = model.baseline.global, airline = model.baseline[`airline:${row.airline}`], route = model.baseline[`route:${caaRouteKey(row)}`];
  const prior = (global[field] + .5) / (global.matched + 1);
  const airlineRate = ((airline?.[field] ?? 0) + 500 * prior) / ((airline?.matched ?? 0) + 500);
  const routeRate = ((route?.[field] ?? 0) + 200 * airlineRate) / ((route?.matched ?? 0) + 200);
  const month = model.baseline[`month:${row.period.slice(4)}`] ?? global;
  const seasonal = (month[field] + 500 * prior) / (month.matched + 500);
  return sigmoid(logit(routeRate) + logit(seasonal) - logit(prior));
}
/** The same calculation is checked against both Python export fixtures and native LightGBM. */
export function scoreCaaModel(model: CaaModel, row: CaaFeatures) {
  const values = caaVector(model, row);
  return monotoneProbabilities(model.models.map(m => {
    const learned = sigmoid(m.trees.reduce((sum, tree) => sum + treeValue(tree, values), 0));
    const blended = m.blend * learned + (1 - m.blend) * seasonalBaseline(model, row, `late${m.threshold}` as "late30" | "late60" | "late180");
    return sigmoid(m.calibration.a * logit(blended) + m.calibration.b);
  }));
}

let cache: { path: string; mtime: number; size: number; model: CaaModel } | null = null;
let pendingModel: { path: string; mtime: number; size: number; promise: Promise<CaaModel> } | null = null;
export function clearCaaModelCache() { cache = null; pendingModel = null; }
async function loadModel() {
  const path = process.env.CAA_MODEL_PATH || "./ml/models/caa-model.json", info = await stat(path);
  if (cache?.path === path && cache.mtime === info.mtimeMs && cache.size === info.size) return cache.model;
  if (pendingModel?.path === path && pendingModel.mtime === info.mtimeMs && pendingModel.size === info.size) return pendingModel.promise;
  const promise = readFile(path, "utf8").then(raw => {
    const model = caaModelSchema.parse(JSON.parse(raw));
    cache = { path, mtime: info.mtimeMs, size: info.size, model }; return model;
  }).finally(() => { if (pendingModel?.promise === promise) pendingModel = null; });
  pendingModel = { path, mtime: info.mtimeMs, size: info.size, promise }; return promise;
}
function endOfPeriod(value: string) { return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4)), 1) / 1000; }
function unavailableReason(model: CaaModel, now: number) {
  if (!model.release.passed) return "Model failed held-out release checks.";
  if (Date.parse(model.trainedAt) / 1000 > now || endOfPeriod(model.dataThrough) > now) return "Model timestamps are in the future.";
  if (now - endOfPeriod(model.dataThrough) > model.maximumModelAgeDays * 86400) return "Model calibration data is stale; retrain before serving ML probabilities.";
  return null;
}
export async function caaMlStatus() {
  try {
    const model = await loadModel(), message = unavailableReason(model, Date.now() / 1000);
    return { available: !message, method: "caa-lightgbm-v1", message, version: model.version, trainedAt: model.trainedAt,
      dataThrough: model.dataThrough, metrics: model.metrics, periods: model.periods, release: model.release,
      predictionEndpoint: "/api/schedule/predict", supportedInputs: ["origin", "destination", "operatingAirline", "scheduledDeparture", "scheduledArrival"],
      dataset: model.dataset, partitionSamples: model.partitionSamples, evaluationScope: model.evaluationScope,
      coverage: "European routes linked to Heathrow, Gatwick, Manchester and Edinburgh; known route/airline/direction cohorts only.",
      airlines: model.vocabulary.airline,
      limitations: "Monthly cohort probabilities. Individual flight accuracy, precise delay minutes and live operational effects have not been validated." };
  } catch (e) {
    return { available: false, method: "caa-lightgbm-v1", message: (e as NodeJS.ErrnoException).code === "ENOENT" ? "Run npm run ml:setup to download data and train the model." : "Model artifact is invalid or unreadable; ML inference is disabled." };
  }
}
const UK = new Set(["EGLL", "EGKK", "EGCC", "EGPH"]);
export async function caaMlRoutes(limit = 30) {
  let model: CaaModel;
  try { model = await loadModel(); } catch { return []; }
  if (unavailableReason(model, Date.now() / 1000)) return [];
  return model.vocabulary.route.flatMap(key => {
    const [origin, destination, operatingAirline, direction] = key.split("|"), cohort = model.baseline[`route:${key}`];
    // Domestic UK routes use destination arrivals, matching the prediction API.
    if (!cohort || cohort.matched < model.minimumRouteSamples || cohort.periods.length < model.minimumRouteMonths || (UK.has(destination) && direction !== "A")) return [];
    return [{ origin, destination, operatingAirline, cohortSamples: cohort.matched }];
  }).sort((a, b) => b.cohortSamples - a.cohortSamples).slice(0, limit);
}
export async function caaMlRisk(input: { origin: string; destination: string; operatingAirline: string; scheduledDeparture: number }) {
  let model: CaaModel;
  try { model = await loadModel(); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (unavailableReason(model, now) || input.scheduledDeparture < now + 3600 || input.scheduledDeparture > now + model.maximumHorizonDays * 86400) return null;
  const direction = UK.has(input.destination) ? "A" : UK.has(input.origin) ? "D" : null;
  if (!direction) return null;
  const date = new Date(input.scheduledDeparture * 1000);
  const row = { origin: input.origin, destination: input.destination, airline: canonicalPublishedAirline(input.operatingAirline), direction,
    period: `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}` };
  const cohort = model.baseline[`route:${caaRouteKey(row)}`];
  if (!cohort || cohort.matched < model.minimumRouteSamples || cohort.periods.length < model.minimumRouteMonths) return null;
  const p = scoreCaaModel(model, row);
  return { probability30: p[0], probability60: p[1], probability180: p[2], expectedDelayMin: null,
    modelVersion: model.version, method: "caa-lightgbm-v1", predictionType: "modelled_cohort_risk", cohort: "modelled_route_and_airline",
    cohortSamples: cohort.matched, cohortSevereDelays: cohort.late180, globalSamples: model.baseline.global.matched,
    priorFlights: model.models.some(m => m.blend < 1) ? 200 : 0, asOf: now, predictedAt: now, dataThrough: model.dataThrough,
    direction: direction === "A" ? "arrival" : "departure", reportingAirport: direction === "A" ? input.destination : input.origin,
    target: "Modelled monthly cohort probability of strictly more than 30, 60 and 180 minutes late at the reporting airport",
    thresholds: { comparison: "strictly_greater_than", minutes: [30, 60, 180] },
    periods: model.periods.train, source: "UK Civil Aviation Authority · calibrated LightGBM ensemble", sourceUrls: model.dataset.sourceUrls,
    delayDenominator: "Matched operated movements; cancellations and unmatched movements excluded",
    evaluationScope: model.evaluationScope,
    limitations: "Seasonal route/airline risk, not validated individual-flight accuracy. CAA schedules may change up to 30 minutes before operation and missing gate times may use estimated taxi times. No exact delay-minute, cancellation, compensation, weather or aircraft-rotation forecast is inferred." };
}
