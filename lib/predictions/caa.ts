export type PublishedRow={period:string;reportingAirport:string;otherAirport:string;airline:string;direction:string;matched:number;unmatched:number;cancelled:number;late30:number;late60:number;late180:number;averageDelay:number|null;sourceUrl:string;sourceRunDate:string;retrievedAt:number};
const aliases:Record<string,string>={BA:"BRITISH AIRWAYS PLC",BAW:"BRITISH AIRWAYS PLC",BRITISHAIRWAYS:"BRITISH AIRWAYS PLC",BRITISHAIRWAYSPLC:"BRITISH AIRWAYS PLC",KL:"KLM",KLM:"KLM",FR:"RYANAIR",RYR:"RYANAIR",RYANAIR:"RYANAIR",EZY:"EASYJET UK LTD",EASYJET:"EASYJET UK LTD",EASYJETUKLTD:"EASYJET UK LTD",W6:"WIZZ AIR",WIZZAIR:"WIZZ AIR",W9:"WIZZ AIR UK LTD",WIZZAIRUK:"WIZZ AIR UK LTD",WIZZAIRUKLTD:"WIZZ AIR UK LTD"};
export const canonicalPublishedAirline=(value:string)=>aliases[value.toUpperCase().replace(/[^A-Z0-9]/g,"")]||value.trim().toUpperCase();
const UK=new Set(["EGLL","EGKK","EGCC","EGPH"]);
export const CAA_LIMITATIONS="Published historical punctuality, not a calibrated forecast for this flight or compensation eligibility. CAA planned times can change up to 30 minutes before operation; missing gate times may use estimated taxi times. Counts are reconstructed from published percentages. Weather does not adjust these rates.";

export function publishedDelayRate(rows:PublishedRow[],input:{origin:string;destination:string;operatingAirline:string},asOf:number){
  const direction=UK.has(input.destination)?"A":UK.has(input.origin)?"D":null;
  if(!direction)return null;
  const reporting=direction==="A"?input.destination:input.origin,other=direction==="A"?input.origin:input.destination;
  const airline=canonicalPublishedAirline(input.operatingAirline);
  const selected=rows.filter(row=>row.reportingAirport===reporting&&row.otherAirport===other&&row.direction===direction&&canonicalPublishedAirline(row.airline)===airline);
  const totals=selected.reduce((sum,row)=>({matched:sum.matched+row.matched,unmatched:sum.unmatched+row.unmatched,cancelled:sum.cancelled+row.cancelled,late30:sum.late30+row.late30,late60:sum.late60+row.late60,late180:sum.late180+row.late180}),{matched:0,unmatched:0,cancelled:0,late30:0,late60:0,late180:0});
  if(totals.matched<100)return null;
  const periods=[...new Set(selected.map(row=>row.period))].sort();
  return {probability30:totals.late30/totals.matched,probability60:totals.late60/totals.matched,probability180:totals.late180/totals.matched,
    cohort:"published_route_and_airline",cohortSamples:totals.matched,cohortSevereDelays:totals.late180,
    globalSamples:rows.reduce((sum,row)=>sum+row.matched,0),priorFlights:0,asOf,predictedAt:asOf,
    method:"caa-published-punctuality-v1",predictionType:"published_historical_rate",direction:direction==="A"?"arrival":"departure",
    target:`Historical ${direction==="A"?"arrival":"departure"} punctuality at ${reporting}; strictly more than 30, 60, and 180 minutes late`,
    reportingAirport:reporting,publishedAirlines:[...new Set(selected.map(row=>row.airline))],periods,
    thresholds:{comparison:"strictly_greater_than",minutes:[30,60,180]},
    delayDenominator:"Matched operated movements; cancellations and unmatched movements excluded",
    cancellationRate:totals.cancelled/(totals.matched+totals.unmatched+totals.cancelled),
    cancellationDenominator:"Matched, unmatched, and cancelled movements in the same published cohort",
    cancelledMovements:totals.cancelled,unmatchedMovements:totals.unmatched,
    source:"UK Civil Aviation Authority",sourceUrls:[...new Set(selected.map(row=>row.sourceUrl))],
    methodologyUrl:"https://www.caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/uk-flight-punctuality-statistics-notes/",
    sourceRetrievedAt:Math.max(...selected.map(row=>row.retrievedAt)),limitations:CAA_LIMITATIONS};
}

export function publishedStatus(rows:PublishedRow[]){
  const cohorts=new Map<string,number>();
  for(const row of rows){const key=[row.reportingAirport,row.otherAirport,canonicalPublishedAirline(row.airline),row.direction].join("|");cohorts.set(key,(cohorts.get(key)||0)+row.matched);}
  const supportedCohorts=[...cohorts.values()].filter(count=>count>=100).length;
  return {available:supportedCohorts>0,source:"UK Civil Aviation Authority",aggregateRecords:rows.length,
    matchedMovements:rows.reduce((sum,row)=>sum+row.matched,0),supportedCohorts,minimumCohortSamples:100,
    periods:[...new Set(rows.map(row=>row.period))].sort(),reportingAirports:[...new Set(rows.map(row=>row.reportingAirport))].sort(),
    airlines:[...new Set(rows.map(row=>row.airline))].sort(),
    coverage:"Selected UK airports and mapped routes only. Movement counts across reporting airports may include the same UK domestic flight twice.",
    limitations:CAA_LIMITATIONS};
}
