export type DelayCounts={total:number;over30:number;over60:number;over180:number};
export type DelayGroup=DelayCounts&{origin:string;destination:string;operatingAirline:string};
const empty=():DelayCounts=>({total:0,over30:0,over60:0,over180:0});
const add=(target:DelayCounts,part:DelayCounts)=>{target.total+=part.total;target.over30+=part.over30;target.over60+=part.over60;target.over180+=part.over180;};
const key=(...parts:string[])=>parts.join("|");
export function summarizeDelays(groups:DelayGroup[]){
  const global=empty(),exact=new Map<string,DelayCounts>(),routes=new Map<string,DelayCounts>(),airlines=new Map<string,DelayCounts>();
  for(const group of groups){
    add(global,group);
    for(const [map,id] of [[exact,key(group.origin,group.destination,group.operatingAirline)],[routes,key(group.origin,group.destination)],[airlines,group.operatingAirline]] as const){
      const counts=map.get(id)||empty();add(counts,group);map.set(id,counts);
    }
  }
  return {global,exact,routes,airlines};
}
export type DelaySummary=ReturnType<typeof summarizeDelays>;
export function estimateDelay(summary:DelaySummary,input:{origin:string;destination:string;operatingAirline:string}){
  const global=summary.global;
  if(global.total<1000||global.over180<10)return null;
  const exact=summary.exact.get(key(input.origin,input.destination,input.operatingAirline));
  const route=summary.routes.get(key(input.origin,input.destination));
  const airline=summary.airlines.get(input.operatingAirline);
  const selected=exact&&exact.total>=30?{scope:"route_and_airline",counts:exact,prior:200}
    :route&&route.total>=50?{scope:"route",counts:route,prior:250}
    :airline&&airline.total>=100?{scope:"airline",counts:airline,prior:500}
    :{scope:"all_imported_flights",counts:global,prior:0};
  const risk=(event:"over30"|"over60"|"over180")=>
    (selected.counts[event]+selected.prior*global[event]/global.total)/(selected.counts.total+selected.prior);
  const p30=risk("over30"),p60=Math.min(p30,risk("over60")),p180=Math.min(p60,risk("over180"));
  return {probability30:p30,probability60:p60,probability180:p180,cohort:selected.scope,
    cohortSamples:selected.counts.total,cohortSevereDelays:selected.counts.over180,
    globalSamples:global.total,globalSevereDelays:global.over180,
    priorFlights:selected.prior,method:"Historical gate-arrival rates with shrinkage toward the overall rate"};
}
