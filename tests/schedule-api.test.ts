import { describe,expect,it } from "vitest";
import { handler } from "@/aws/predictions";
import { estimateDelay,summarizeDelays } from "@/lib/predictions/empirical";
import { predictRisk } from "@/lib/predictions/schedule-service";

const history=()=>summarizeDelays([
  {origin:"EHAM",destination:"EDDF",operatingAirline:"TEST",total:100,over30:20,over60:10,over180:4},
  {origin:"EGLL",destination:"LFPG",operatingAirline:"OTHER",total:900,over30:90,over60:40,over180:8},
]);
describe("empirical Lambda delay estimates",()=>{
  it("refuses to invent rates for small or event-free history",()=>{
    expect(estimateDelay(summarizeDelays([]),{origin:"EHAM",destination:"EDDF",operatingAirline:"TEST"})).toBeNull();
    const noSevere=summarizeDelays([{origin:"EHAM",destination:"EDDF",operatingAirline:"TEST",total:1000,over30:100,over60:20,over180:0}]);
    expect(estimateDelay(noSevere,{origin:"EHAM",destination:"EDDF",operatingAirline:"TEST"})).toBeNull();
  });
  it("uses supported comparable flights and shrinks rare-event rates",()=>{
    const estimate=estimateDelay(history(),{origin:"EHAM",destination:"EDDF",operatingAirline:"TEST"})!;
    expect(estimate.cohort).toBe("route_and_airline");
    expect(estimate.cohortSamples).toBe(100);
    expect(estimate.globalSamples).toBe(1000);
    expect(estimate.probability180).toBeCloseTo((4+200*.012)/300);
    expect(estimate.probability30).toBeGreaterThan(estimate.probability60);
    expect(estimate.probability60).toBeGreaterThan(estimate.probability180);
  });
  it("labels the broad fallback when a route has no history",()=>{
    const estimate=estimateDelay(history(),{origin:"LIRF",destination:"EDDM",operatingAirline:"NEW"})!;
    expect(estimate.cohort).toBe("all_imported_flights");
    expect(estimate.probability180).toBeCloseTo(.012);
  });
  it("requires a server token and rejects late flights before querying history",async()=>{
    const event={rawPath:"/v1/predictions",body:JSON.stringify({origin:"EHAM",destination:"EDDF",operatingAirline:"TEST",scheduledDeparture:Math.floor(Date.now()/1000)+120,scheduledArrival:Math.floor(Date.now()/1000)+7200}),requestContext:{http:{method:"POST"}}};
    expect((await handler(event)).statusCode).toBe(401);
    const old=process.env.PREDICTION_API_TOKEN;process.env.PREDICTION_API_TOKEN="unit-test-token";
    try{expect((await handler({...event,headers:{authorization:"Bearer unit-test-token"}})).statusCode).toBe(422);}
    finally{if(old===undefined)delete process.env.PREDICTION_API_TOKEN;else process.env.PREDICTION_API_TOKEN=old;}
    await expect(predictRisk(JSON.parse(event.body))).rejects.toMatchObject({code:"TOO_LATE"});
  });
});
