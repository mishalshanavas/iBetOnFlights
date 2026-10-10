import { readCache, writeCache } from "@/lib/db/repository";
const memory=new Map<string,{value:unknown;expires:number}>();
const pending=new Map<string,Promise<unknown>>();
export async function cached<T>(key:string,seconds:number,loader:()=>Promise<T>):Promise<{value:T;cached:boolean}> {
  const existing=memory.get(key);
  if(existing && existing.expires>Date.now())return {value:existing.value as T,cached:true};
  try {const value=await readCache<T>(key);if(value){memory.set(key,{value,expires:Date.now()+Math.min(seconds,15)*1000});return {value,cached:true};}}catch{/* Provider reads remain available if database is down. */}
  const inflight=pending.get(key);if(inflight)return {value:await inflight as T,cached:true};
  const job=loader().then(async value=>{memory.set(key,{value,expires:Date.now()+seconds*1000});try{await writeCache(key,value,seconds);}catch{/* Persisted source health reports storage errors separately. */}return value;});
  pending.set(key,job);try{return {value:await job,cached:false};}finally{pending.delete(key);}
}
