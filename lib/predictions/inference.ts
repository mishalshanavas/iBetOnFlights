import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ProviderError } from "@/lib/providers/base";
export const featureNames=["origin_code","destination_code","departure_hour","arrival_hour","day_of_week","month","route_distance_km","route_delay_rate","airport_delay_rate","wind_speed_ms","wind_gust_ms","precipitation_mm","visibility_m","cloud_cover_pct"] as const;
interface Tree {split_feature?:number;threshold?:number;default_left?:boolean;decision_type?:string;left_child?:Tree;right_child?:Tree;leaf_value?:number}
interface Model {version:string;features:string[];evaluatedOnEuropeanRecords:boolean;models:{threshold:number;trees:Tree[];calibration:{a:number;b:number}}[];metrics:unknown;trainedAt:string;testPeriod:string[];airportEncoding:Record<string,number>}
export const predictionInput=z.object({features:z.record(z.string(),z.number().finite()),flightId:z.string().max(100).optional(),sourceDataTimestamp:z.number().optional()});
export function treeValue(node:Tree,features:number[]):number {
  if(node.leaf_value!==undefined)return node.leaf_value;
  if(node.split_feature===undefined||!node.left_child||!node.right_child||node.decision_type!=="<=")throw new Error("Unsupported exported tree.");
  const v=features[node.split_feature];return treeValue(Number.isNaN(v)?node.default_left?node.left_child:node.right_child:v<=Number(node.threshold)?node.left_child:node.right_child,features);
}
export const sigmoid=(v:number)=>1/(1+Math.exp(-Math.max(-700,Math.min(700,v))));
export function monotoneProbabilities(p:number[]){return p.map((v,i)=>Math.min(...p.slice(0,i+1).map(n=>Math.max(0,Math.min(1,n)))));}
let loaded:Model|null=null;
export async function modelStatus(){try{const model=await loadModel();return {available:true,version:model.version,features:model.features,europeanValidated:model.evaluatedOnEuropeanRecords,trainedAt:model.trainedAt,testPeriod:model.testPeriod,metrics:model.metrics,airportEncoding:model.airportEncoding};}catch{return {available:false,message:"Prediction model not trained or unavailable.",features:featureNames};}}
async function loadModel(){
  if(loaded)return loaded;
  let raw:Model;
  try{raw=JSON.parse(await readFile(process.env.MODEL_PATH||"./ml/models/model.json","utf8"));}catch{throw new ProviderError("MODEL_UNAVAILABLE","Prediction model not trained or unavailable.");}
  if(!raw.version||!raw.features||JSON.stringify(raw.features)!==JSON.stringify(featureNames)||!raw.models||raw.models.length!==3||raw.models.some((m,i)=>m.threshold!==[30,60,180][i]))throw new ProviderError("INVALID_MODEL","The model feature schema or threshold ordering is incompatible.");
  loaded=raw;return loaded;
}
export async function predict(features:Record<string,number>){
  const model=await loadModel();const vector=featureNames.map(name=>{if(!Number.isFinite(features[name]))throw new ProviderError("MISSING_FEATURE",`A validated value is required for ${name}.`,422);return features[name];});
  const probabilities=monotoneProbabilities(model.models.map(m=>sigmoid(m.calibration.a*m.trees.reduce((sum,tree)=>sum+treeValue(tree,vector),0)+m.calibration.b)));
  return {probability30:probabilities[0],probability60:probabilities[1],probability180:probabilities[2],modelVersion:model.version,europeanValidated:model.evaluatedOnEuropeanRecords,predictedAt:Math.floor(Date.now()/1000),expectedDelayMin:null,source:"Calibrated LightGBM inference",limitations:model.evaluatedOnEuropeanRecords?"Feature attribution does not establish causation.":"This model has not been evaluated on European flight records."};
}
