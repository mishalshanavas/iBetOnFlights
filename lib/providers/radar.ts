import { z } from "zod";
import type { RadarResponse } from "@/lib/types";
import { ProviderError, timedFetch, type RadarTileProvider } from "./base";
import { cached } from "./cache";
import { now } from "@/lib/db/repository";
export const rainviewer:RadarTileProvider={async fetch(){
  if(process.env.RADAR_TILE_PROVIDER==="disabled")throw new ProviderError("NOT_CONFIGURED","Radar provider disabled.");
  const result=await cached<RadarResponse>("rainviewer:frames",300,async()=>{
    const response=await timedFetch("https://api.rainviewer.com/public/weather-maps.json");
    if(!response.ok)throw new ProviderError("RADAR_UNAVAILABLE","RainViewer radar imagery is temporarily unavailable.",502);
    const raw=z.object({host:z.string().url().refine(v=>new URL(v).protocol==="https:" && new URL(v).hostname.endsWith(".rainviewer.com")),radar:z.object({past:z.array(z.object({time:z.number(),path:z.string().regex(/^\/v2\/radar\/[\w-]+$/)}))})}).parse(await response.json());
    if(!raw.radar.past.length)throw new ProviderError("NO_RADAR_FRAMES","No radar frames are available.");
    return {host:raw.host,frames:raw.radar.past,source:{provider:"RainViewer",status:"recent",observedAt:raw.radar.past.at(-1)!.time,retrievedAt:now(),message:"Radar composite frame timestamps; coverage varies. Personal / educational use."}};
  });return {...result.value,source:{...result.value.source,status:result.cached?"cached":"recent"}};
}};
