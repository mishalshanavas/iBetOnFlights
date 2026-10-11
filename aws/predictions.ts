import { z } from "zod";
import { ProviderError } from "@/lib/providers/base";
import { predictRisk,predictRiskBatch,riskStatus,upcomingFlightPredictions } from "@/lib/predictions/schedule-service";
import { itineraryContext } from "@/lib/predictions/weather-context";
import { dayFlightPredictions } from "@/lib/predictions/day-service";

type Event={version?:string;rawPath?:string;queryStringParameters?:Record<string,string>;body?:string|null;isBase64Encoded?:boolean;headers?:Record<string,string|undefined>;requestContext?:{http?:{method?:string}}};
const response=(statusCode:number,value:unknown)=>({statusCode,headers:{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"},body:JSON.stringify(value)});
export async function handler(event:Event){
  const secret=process.env.PREDICTION_API_TOKEN;
  if(!secret||event.headers?.authorization!==`Bearer ${secret}`)return response(401,{error:{code:"UNAUTHORIZED",message:"A valid server token is required."}});
  try{
    const method=event.requestContext?.http?.method,path=event.rawPath;
    if(method==="GET"&&(path==="/v1/status"||path==="/v1/model/status"))return response(200,await riskStatus());
    if(method==="GET"&&path==="/v1/flights")return response(200,await upcomingFlightPredictions(50));
    if(method==="GET"&&path==="/v1/flights/day")return response(200,await dayFlightPredictions(event.queryStringParameters||{}));
    if(method==="POST"&&(path==="/v1/predictions"||path==="/v1/predictions/batch"||path==="/v1/context")){
      if(!event.body||event.body.length>32768)return response(413,{error:{code:"TOO_LARGE",message:"Request body must be at most 32 KB."}});
      const text=event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body;
      if(text.length>32768)return response(413,{error:{code:"TOO_LARGE",message:"Request body must be at most 32 KB."}});
      let data:unknown;try{data=JSON.parse(text);}catch{return response(400,{error:{code:"INVALID_JSON",message:"Send a valid JSON body."}});}
      return response(200,path==="/v1/context"?await itineraryContext(data):path.endsWith("/batch")?await predictRiskBatch(data):await predictRisk(data));
    }
    return response(404,{error:{code:"NOT_FOUND",message:"Endpoint not found."}});
  }catch(e){
    if(e instanceof z.ZodError)return response(400,{error:{code:"INVALID_INPUT",message:e.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}});
    if(e instanceof ProviderError)return response(e.status,{error:{code:e.code,message:e.message}});
    return response(503,{error:{code:"SERVICE_UNAVAILABLE",message:"The prediction service is unavailable."}});
  }
}
