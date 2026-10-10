import { z } from "zod";
import { findAirport } from "@/data/airports";
import { distanceKm } from "@/lib/aviation/geo";
export const assessmentInput=z.object({
  origin:z.string().length(4),destination:z.string().length(4),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,"Invalid flight date"),
  flightNumber:z.string().max(20).default(""),airline:z.string().max(100).default(""),
  airlineJurisdiction:z.enum(["EU","NON_EU","UNKNOWN"]),arrivalDelay:z.number().min(0).max(10080),
  cancelled:z.boolean().default(false),noticeDays:z.number().min(0).max(365).nullable().default(null),
  rerouted:z.boolean().default(false),rerouteDepartureEarlyMinutes:z.number().min(0).max(1440).nullable().default(null),
  reason:z.enum(["unknown","airline","technical","weather","atc","airport","strike","security"]),
  extraordinaryProven:z.boolean().default(false),reasonableMeasuresProven:z.boolean().default(false),
  ticketType:z.enum(["public","frequent_flyer","non_public_free"]).default("public"),
  thirdCountryBenefits:z.boolean().default(false)
}).refine(v=>v.origin!==v.destination,"Origin and destination must be different.");
export type AssessmentInput=z.input<typeof assessmentInput>;
export type Eligibility="NOT_COVERED"|"NO_QUALIFYING_DISRUPTION"|"POTENTIALLY_ELIGIBLE"|"REQUIRES_EVIDENCE"|"POSSIBLY_EXEMPT"|"CONFIRMED_ELIGIBLE";
const eu=new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]);
const covered=(c:string)=>eu.has(c)||["NO","IS"].includes(c);
export function evaluateCompensation(raw:AssessmentInput) {
  const input=assessmentInput.parse(raw),origin=findAirport(input.origin),destination=findAirport(input.destination);
  if(!origin||!destination)throw new Error("Select airports in the supported dataset.");
  const amended=input.date>="2027-10-23";
  const regulationVersion=amended?"EC261-as-amended-EU2026/2202-v1":"EC261/2004-CJEU-v1";
  const sourceUrl=amended?"https://eur-lex.europa.eu/eli/reg/2026/2202/oj/eng":"https://eur-lex.europa.eu/eli/reg/2004/261/oj/eng";
  const distance=distanceKm(origin.latitude,origin.longitude,destination.latitude,destination.longitude);
  const intraEU=eu.has(origin.countryCode)&&eu.has(destination.countryCode);
  const distanceCategory=distance<=1500?"Up to 1,500 km":intraEU?"Intra-EU over 1,500 km":distance<=3500?"1,500–3,500 km":"Over 3,500 km";
  const baseAmount=distance<=1500?250:intraEU||distance<=3500?400:600;
  let applies:boolean|null=covered(origin.countryCode)?true:covered(destination.countryCode)?input.airlineJurisdiction==="UNKNOWN"?null:input.airlineJurisdiction==="EU":false;
  // Swiss and UK domestic regimes require a distinct adapter; never imply EU membership.
  if(input.ticketType==="non_public_free" || (!covered(origin.countryCode)&&input.thirdCountryBenefits))applies=false;
  let status:Eligibility="POTENTIALLY_ELIGIBLE",amount=baseAmount,reduction=0;
  const explanations:string[]=[],missingEvidence=["Booking confirmation and operating carrier identity","Evidence of actual arrival time (door opening)","Airline's documented disruption reason and reasonable measures"];
  if(applies===false){status="NOT_COVERED";amount=0;explanations.push("This itinerary or ticket is outside the implemented EU/EEA scope. UK and Swiss passenger-rights regimes require separate assessment.");}
  else if(applies===null){status="REQUIRES_EVIDENCE";explanations.push("For a flight departing outside the EU/EEA, establish that the operating airline is an applicable EU/EEA carrier.");missingEvidence.push("Operating airline jurisdiction");}
  else if(!input.cancelled && (amended?input.arrivalDelay<=180:input.arrivalDelay<180)){
    status="NO_QUALIFYING_DISRUPTION";amount=0;explanations.push(amended?"The amended arrival-delay wording requires a delay exceeding three hours.":"Arrival delay is below the three-hour compensation threshold. Separate rights to care or reimbursement may apply.");
  }else if(input.cancelled){
    if(input.noticeDays===null){status="REQUIRES_EVIDENCE";missingEvidence.push("When cancellation was communicated");}
    else if(input.noticeDays>=14){status="NO_QUALIFYING_DISRUPTION";amount=0;explanations.push("Cancellation was communicated at least 14 days before departure.");}
    else if(input.rerouted && input.rerouteDepartureEarlyMinutes===null){status="REQUIRES_EVIDENCE";missingEvidence.push("Rerouted departure time relative to the original schedule");}
    else if(input.rerouted && input.rerouteDepartureEarlyMinutes!==null){
      const earlyLimit=!amended&&input.noticeDays>=7?120:60;
      const lateLimit=!amended&&input.noticeDays>=7?240:120;
      if(input.rerouteDepartureEarlyMinutes<=earlyLimit && input.arrivalDelay<lateLimit){status="NO_QUALIFYING_DISRUPTION";amount=0;explanations.push("The cancellation notice and offered rerouting fall within the applicable exception.");}
    }
  }
  if(amount>0 && applies!==false && status!=="NO_QUALIFYING_DISRUPTION"){
    if(input.extraordinaryProven && input.reasonableMeasuresProven){status="POSSIBLY_EXEMPT";explanations.push("The supplied evidence indicates extraordinary circumstances and reasonable measures. Review the direct causal link; no claim is automatically denied.");}
    else if(input.reason!=="airline"){status="REQUIRES_EVIDENCE";explanations.push("The disruption category alone does not establish airline liability or an extraordinary-circumstances exemption.");}
    const threshold=baseAmount===250?120:baseAmount===400?180:240;
    if(amended){
      if(baseAmount===600 && input.arrivalDelay<=240)reduction=0.5;
      if(input.cancelled && input.rerouted && input.rerouteDepartureEarlyMinutes!==null && input.rerouteDepartureEarlyMinutes>60 && input.rerouteDepartureEarlyMinutes<180)reduction=Math.max(reduction,input.rerouteDepartureEarlyMinutes<120?0.5:0.25);
    }else if((input.rerouted && input.arrivalDelay<=threshold) || (!input.cancelled&&baseAmount===600&&input.arrivalDelay<240))reduction=0.5;
    amount=Math.round(baseAmount*(1-reduction));
    explanations.push(`Great-circle distance is ${Math.round(distance).toLocaleString()} km. The applicable distance band provides a base amount of €${baseAmount}.`);
    if(reduction)explanations.push(`A potential ${reduction*100}% reduction is reflected in the amount; verify rerouting and arrival evidence.`);
    explanations.push("This is a preliminary assessment from supplied information; compensation is not approved or guaranteed.");
  }
  return {status,applies,distanceKm:Math.round(distance),distanceCategory,baseAmount,potentialAmount:amount,reduction,regulationVersion,sourceUrl,missingEvidence:amount>0?missingEvidence:[],explanation:explanations.join(" "),input};
}
export type AssessmentResult=ReturnType<typeof evaluateCompensation>;
