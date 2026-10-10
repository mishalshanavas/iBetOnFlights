import { describe,expect,it } from "vitest";
import { publishedDelayRate,publishedStatus,type PublishedRow } from "@/lib/predictions/caa";

const row=(overrides:Partial<PublishedRow>={}):PublishedRow=>({period:"202601",reportingAirport:"EGLL",otherAirport:"EHAM",airline:"KLM",direction:"A",matched:200,unmatched:10,cancelled:20,late30:40,late60:20,late180:4,averageDelay:12,sourceUrl:"https://www.caa.co.uk/example",sourceRunDate:"test fixture",retrievedAt:1000,...overrides});
const input={origin:"EHAM",destination:"EGLL",operatingAirline:"KL"};
describe("published CAA punctuality",()=>{
  it("pools counts across months with the correct operated-flight denominator",()=>{
    const rate=publishedDelayRate([row(),row({period:"202602",matched:100,late30:10,late60:5,late180:1})],input,2000)!;
    expect(rate.cohortSamples).toBe(300);
    expect(rate.probability30).toBeCloseTo(50/300);
    expect(rate.probability180).toBeCloseTo(5/300);
    expect(rate.cancellationRate).toBeCloseTo(40/360);
    expect(rate.direction).toBe("arrival");
    expect(rate.thresholds.comparison).toBe("strictly_greater_than");
    expect(rate.periods).toEqual(["202601","202602"]);
  });
  it("keeps departure and arrival statistics separate",()=>{
    const rows=[row(),row({direction:"D",late180:10})];
    expect(publishedDelayRate(rows,input,2000)?.probability180).toBe(.02);
    const outbound=publishedDelayRate(rows,{...input,origin:"EGLL",destination:"EHAM"},2000)!;
    expect(outbound.direction).toBe("departure");
    expect(outbound.target).toContain("departure");
    expect(outbound.probability180).toBe(.05);
  });
  it("does not turn unrelated or insufficient cohorts into route predictions",()=>{
    expect(publishedDelayRate([row({matched:99})],input,2000)).toBeNull();
    expect(publishedDelayRate([row()],{...input,operatingAirline:"BRITISH AIRWAYS"},2000)).toBeNull();
    expect(publishedDelayRate([row()],{...input,destination:"EDDF"},2000)).toBeNull();
  });
  it("discloses aggregates separately from individual flights",()=>{
    const status=publishedStatus([row(),row({direction:"D"})]);
    expect(status.aggregateRecords).toBe(2);
    expect(status.matchedMovements).toBe(400);
    expect(status.supportedCohorts).toBe(2);
    expect(status.coverage).toContain("twice");
  });
});
