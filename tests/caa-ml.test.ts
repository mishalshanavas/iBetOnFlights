import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caaMlRisk, caaMlRoutes, caaMlStatus, caaModelSchema, clearCaaModelCache, scoreCaaModel } from "@/lib/predictions/caa-ml";
import { clearRiskHistoryCache, predictRisk, predictRiskBatch } from "@/lib/predictions/schedule-service";
import { clearPublishedHistoryCache } from "@/lib/predictions/published-service";
import * as database from "@/lib/db";
import { explainRisk, riskSchema } from "@/lib/predictions/day";

const instant = Date.parse("2026-10-16T12:00:00Z");
const itinerary = { origin: "EHAM", destination: "EGLL", operatingAirline: "KL", scheduledDeparture: instant / 1000 + 86400, scheduledArrival: instant / 1000 + 90000 };
let original: string | undefined, directory: string;
const artifact = JSON.parse(await readFile("ml/models/caa-model.json", "utf8"));

describe("CAA ML backend", () => {
  beforeEach(async () => {
    original = process.env.CAA_MODEL_PATH;
    directory = await mkdtemp(join(tmpdir(), "flightguard-ml-"));
    process.env.CAA_MODEL_PATH = join(directory, "model.json");
    await writeFile(process.env.CAA_MODEL_PATH, JSON.stringify(artifact));
    clearCaaModelCache(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(instant);
  });
  afterEach(async () => {
    vi.useRealTimers(); clearCaaModelCache();
    if (original === undefined) delete process.env.CAA_MODEL_PATH; else process.env.CAA_MODEL_PATH = original;
    await rm(directory, { recursive: true, force: true });
  });
  it("matches every exported Python score, including probabilities for rare delays", () => {
    const model = caaModelSchema.parse(artifact);
    for (const fixture of artifact.parity) {
      const p = scoreCaaModel(model, fixture.input);
      p.forEach((value, i) => expect(value).toBeCloseTo(fixture.probabilities[i], 12));
      expect(p[0]).toBeGreaterThanOrEqual(p[1]); expect(p[1]).toBeGreaterThanOrEqual(p[2]);
    }
  });
  it("scores the real schedule path, resolves airline aliases and preserves target semantics", async () => {
    const prediction = await predictRisk(itinerary);
    expect(prediction.method).toBe("caa-lightgbm-v1");
    expect(prediction).toMatchObject({ direction: "arrival", reportingAirport: "EGLL", expectedDelayMin: null, predictionType: "modelled_cohort_risk" });
    expect(prediction.probability30).toBeGreaterThan(prediction.probability180);
    const words = explainRisk(riskSchema.parse(prediction)).join(" ");
    expect(words).toContain("Modelled cohort risk"); expect(words).toContain("more than 30");
    const outbound = await caaMlRisk({ ...itinerary, origin: "EGLL", destination: "EHAM" });
    expect(outbound?.direction).toBe("departure");
  });
  it("serves ML batches when history storage fails and isolates invalid prediction times", async () => {
    const failure = vi.spyOn(database, "getDb").mockRejectedValue(new Error("Test database unavailable"));
    clearRiskHistoryCache(); clearPublishedHistoryCache();
    try {
      const batch = await predictRiskBatch({ flights: [itinerary, { ...itinerary, scheduledDeparture: instant / 1000 + 10, scheduledArrival: instant / 1000 + 7210 }] });
      expect(batch.predictions[0].prediction?.method).toBe("caa-lightgbm-v1");
      expect(batch.predictions[1].error?.code).toBe("TOO_LATE");
      expect(batch.status.available).toBe(true); expect(batch.status.historyAvailable).toBe(false);
    } finally { failure.mockRestore(); clearRiskHistoryCache(); clearPublishedHistoryCache(); }
  });
  it("refuses unrelated routes, unknown airlines, distant dates and insufficient route support", async () => {
    const routes = await caaMlRoutes();
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every(route => route.cohortSamples >= 100)).toBe(true);
    expect(await caaMlRisk({ ...itinerary, destination: "EDDF" })).toBeNull();
    expect(await caaMlRisk({ ...itinerary, operatingAirline: "UNSEEN AIRLINE" })).toBeNull();
    expect(await caaMlRisk({ ...itinerary, scheduledDeparture: instant / 1000 + 181 * 86400 })).toBeNull();
    const changed = structuredClone(artifact);
    changed.baseline["route:EHAM|EGLL|KLM|A"].matched = 99;
    changed.baseline["route:EHAM|EGLL|KLM|A"].late30 = 20;
    changed.baseline["route:EHAM|EGLL|KLM|A"].late60 = 10;
    changed.baseline["route:EHAM|EGLL|KLM|A"].late180 = 1;
    await writeFile(process.env.CAA_MODEL_PATH!, JSON.stringify(changed));
    expect(await caaMlRisk(itinerary)).toBeNull();
  });
  it("disables stale, unreleased, missing and malformed artifacts", async () => {
    expect((await caaMlStatus()).available).toBe(true);
    vi.setSystemTime(Date.parse("2027-01-01T00:00:00Z"));
    expect((await caaMlStatus()).available).toBe(false); expect(await caaMlRisk(itinerary)).toBeNull();
    vi.setSystemTime(instant);
    await writeFile(process.env.CAA_MODEL_PATH!, JSON.stringify({ ...artifact, release: { passed: false, reasons: ["Fixture rejection"] } }));
    expect((await caaMlStatus()).available).toBe(false); expect(await caaMlRisk(itinerary)).toBeNull();
    await writeFile(process.env.CAA_MODEL_PATH!, "{}");
    expect((await caaMlStatus()).available).toBe(false);
    await rm(process.env.CAA_MODEL_PATH!);
    expect((await caaMlStatus()).available).toBe(false);
  });
  it("rejects incompatible feature order and overlapping evaluation periods", () => {
    expect(caaModelSchema.safeParse({ ...artifact, features: [...artifact.features].reverse() }).success).toBe(false);
    expect(caaModelSchema.safeParse({ ...artifact, periods: { ...artifact.periods, test: artifact.periods.train } }).success).toBe(false);
  });
});
