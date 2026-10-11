import { describe, expect, it } from "vitest";
import { dayQuery, explainRisk, flagRisk, riskSchema } from "@/lib/predictions/day";
import { parseAvinorDepartures } from "@/lib/providers/avinor";
import { predictionRoutes } from "@/lib/predictions/routes";
const risk = riskSchema.parse({ probability30: .2, probability60: .1, probability180: .01, cohortSamples: 200, method: "caa-published-punctuality-v1", direction: "departure", reportingAirport: "EGLL", source: "UK Civil Aviation Authority" });
describe("day flight outlook", () => {
  it("rejects invalid days and unbounded pages", () => {
    expect(dayQuery.safeParse({ date: "2026-02-30" }).success).toBe(false);
    expect(dayQuery.safeParse({ date: "2026-10-11", limit: 101 }).success).toBe(false);
    expect(dayQuery.safeParse({ date: "2026-10-11", offset: -1 }).success).toBe(false);
  });
  it("uses separate documented watchlist cutoffs without inferring cancellation from delay", () => {
    expect(flagRisk(null)).toBe("unavailable");
    expect(flagRisk({ ...risk, probability30: .199 })).toBe("lower");
    expect(flagRisk(risk)).toBe("delay");
    expect(flagRisk({ ...risk, cancellationRate: .1 })).toBe("cancellation");
    expect(flagRisk({ ...risk, cancellationRate: .099 })).toBe("delay");
    expect(riskSchema.safeParse({ ...risk, probability30: 2 }).success).toBe(false);
  });
  it("preserves measured direction and explains evidence without inventing a cause", () => {
    expect(explainRisk(risk).join(" ")).toContain("departure at EGLL");
    expect(explainRisk(risk).join(" ")).toContain("Cancellation risk cannot be estimated");
    expect(explainRisk(risk).join(" ")).toContain("cause of a future disruption is unknown");
  });
  it("normalizes the actual public feed format, day boundaries and reported statuses", () => {
    const xml = `<airport><flights><flight uniqueID="1"><flight_id>SK803</flight_id><airline>SK</airline><airport>LHR</airport><schedule_time>2026-10-11T09:00:00Z</schedule_time><arr_dep>D</arr_dep><status code="E" time="2026-10-11T09:45:00Z"/></flight><flight uniqueID="2"><flight_id>DY100</flight_id><airline>DY</airline><airport>LGW</airport><schedule_time>2026-10-11T10:00:00Z</schedule_time><arr_dep>D</arr_dep><status code="C"/></flight><flight uniqueID="3"><schedule_time>2026-10-12T00:00:00Z</schedule_time><arr_dep>D</arr_dep></flight><flight uniqueID="4"><schedule_time>2026-10-11T10:00:00Z</schedule_time><arr_dep>A</arr_dep></flight></flights></airport>`;
    const records = parseAvinorDepartures(xml, "2026-10-11", 1791676800);
    expect(records).toHaveLength(2);
    expect(records[0].flight).toMatchObject({ originIcao: "ENGM", destinationIcao: "EGLL", operatingAirline: "SAS", status: "reported_delay", scheduledArrival: null, aircraftIcao24: null });
    expect(records[1].flight.status).toBe("cancelled");
    expect(records[0].evidence.scheduleObservedAt).toBe(1791676800);
    const routes = predictionRoutes(records.map(row => ({ flight: row.flight, prediction: null, flag: row.flight.status === "cancelled" ? "reported_cancelled" : "reported_delay", reasons: [], error: null })));
    expect(routes.features.map(feature => feature.properties?.color)).toEqual(["#ff9b45", "#f46b75"]);
    expect(routes.features.map(feature => feature.properties?.cancelled)).toEqual([false, true]);
    expect(routes.features[0].properties).toMatchObject({ originIcao: "ENGM", destinationIcao: "EGLL" });
  });
  it("rejects HTML errors and entity documents instead of silently showing no flights", () => {
    expect(() => parseAvinorDepartures("<html>Unavailable</html>", "2026-10-11", 1)).toThrow();
    expect(() => parseAvinorDepartures('<!DOCTYPE root><flights></flights>', "2026-10-11", 1)).toThrow();
  });
});
